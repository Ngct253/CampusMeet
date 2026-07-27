[CmdletBinding()]
param(
  [string]$Profile,
  [string]$Region = 'ap-southeast-1',
  [ValidateSet('dev', 'staging', 'prod')]
  [string]$Environment = 'dev',
  [string]$ExpectedAccountId = '604360241374',
  [switch]$SkipSchema
)

$ErrorActionPreference = 'Stop'
$prefix = "campusmeet-$Environment"

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments)

  $command = @($Arguments)
  if ($Profile) {
    $command += @('--profile', $Profile)
  }

  $command += @('--region', $Region, '--output', 'json')
  $raw = & aws @command
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI failed: aws $($command -join ' ')"
  }

  if (-not $raw) {
    return $null
  }

  return ($raw | ConvertFrom-Json)
}

function Get-KeySchemaText {
  param($KeySchema)

  if (-not $KeySchema) {
    return ''
  }

  return (($KeySchema | Sort-Object KeyType | ForEach-Object {
        "$($_.KeyType):$($_.AttributeName)"
      }) -join ',')
}

$expected = @(
  @{ Suffix = 'users'; Hash = 'userId'; Range = $null; Gsis = @('CognitoSubIndex') }
  @{ Suffix = 'groups'; Hash = 'groupId'; Range = $null; Gsis = @('CreatedByIndex') }
  @{ Suffix = 'memberships'; Hash = 'groupId'; Range = 'userId'; Gsis = @('UserMembershipsIndex') }
  @{ Suffix = 'invitations'; Hash = 'invitationId'; Range = $null; Gsis = @('TokenHashIndex', 'GroupStatusIndex') }
  @{ Suffix = 'meetings'; Hash = 'meetingId'; Range = $null; Gsis = @('GroupStartAtIndex', 'OrganizerStartAtIndex', 'GoogleEventIdIndex') }
  @{ Suffix = 'reminders'; Hash = 'reminderId'; Range = $null; Gsis = @('MeetingRunAtIndex', 'StatusRunAtIndex') }
  @{ Suffix = 'minutes'; Hash = 'meetingId'; Range = $null; Gsis = @() }
  @{ Suffix = 'tasks'; Hash = 'taskId'; Range = $null; Gsis = @('AssigneeDueAtIndex', 'GroupStatusDueAtIndex') }
  @{ Suffix = 'notifications'; Hash = 'notificationId'; Range = $null; Gsis = @('UserCreatedAtIndex') }
  @{ Suffix = 'audit-logs'; Hash = 'auditId'; Range = $null; Gsis = @('GroupCreatedAtIndex') }
  @{ Suffix = 'attachments'; Hash = 'attachmentId'; Range = $null; Gsis = @('MeetingCreatedAtIndex', 'GroupStatusCreatedAtIndex') }
  @{ Suffix = 'recordings'; Hash = 'recordingId'; Range = $null; Gsis = @('MeetingCreatedAtIndex') }
  @{ Suffix = 'recording-consents'; Hash = 'recordingId'; Range = 'userId'; Gsis = @() }
  @{ Suffix = 'transcripts'; Hash = 'transcriptId'; Range = 'segmentId'; Gsis = @('MeetingVersionIndex') }
  @{ Suffix = 'ai-jobs'; Hash = 'aiJobId'; Range = $null; Gsis = @('GroupCreatedAtIndex', 'StatusUpdatedAtIndex') }
  @{ Suffix = 'ai-conversations'; Hash = 'conversationId'; Range = 'messageId'; Gsis = @('UserUpdatedAtIndex') }
  @{ Suffix = 'tool-proposals'; Hash = 'proposalId'; Range = $null; Gsis = @('UserStatusCreatedAtIndex') }
)

Write-Host "Checking AWS identity..."
$identity = Invoke-AwsJson -Arguments @('sts', 'get-caller-identity')
if ($ExpectedAccountId -and $identity.Account -ne $ExpectedAccountId) {
  throw "Wrong AWS account. Expected $ExpectedAccountId but authenticated as $($identity.Account)."
}

Write-Host "Account: $($identity.Account)"
Write-Host "Region:  $Region"
Write-Host "Prefix:  $prefix"
Write-Host ''

$failures = [System.Collections.Generic.List[string]]::new()
$rows = foreach ($item in $expected) {
  $tableName = "$prefix-$($item.Suffix)"

  try {
    $response = Invoke-AwsJson -Arguments @(
      'dynamodb',
      'describe-table',
      '--table-name',
      $tableName
    )

    $table = $response.Table
    $actualHash = ($table.KeySchema | Where-Object KeyType -eq 'HASH').AttributeName
    $actualRange = ($table.KeySchema | Where-Object KeyType -eq 'RANGE').AttributeName
    $actualGsis = @($table.GlobalSecondaryIndexes | ForEach-Object IndexName | Sort-Object)
    $expectedGsis = @($item.Gsis | Sort-Object)

    $schemaOk = $true
    if (-not $SkipSchema) {
      if ($actualHash -ne $item.Hash -or $actualRange -ne $item.Range) {
        $schemaOk = $false
        $failures.Add(
          "$tableName key mismatch. Expected HASH=$($item.Hash), RANGE=$($item.Range); actual $(Get-KeySchemaText $table.KeySchema)."
        )
      }

      if (($actualGsis -join ',') -ne ($expectedGsis -join ',')) {
        $schemaOk = $false
        $failures.Add(
          "$tableName GSI mismatch. Expected [$($expectedGsis -join ', ')]; actual [$($actualGsis -join ', ')]."
        )
      }
    }

    if ($table.TableStatus -ne 'ACTIVE') {
      $failures.Add("$tableName is $($table.TableStatus), not ACTIVE.")
    }

    if ($table.BillingModeSummary.BillingMode -ne 'PAY_PER_REQUEST') {
      $failures.Add("$tableName is not PAY_PER_REQUEST.")
    }

    [pscustomobject]@{
      Table = $tableName
      Status = $table.TableStatus
      Billing = $table.BillingModeSummary.BillingMode
      Keys = Get-KeySchemaText $table.KeySchema
      GSI = $actualGsis.Count
      Schema = if ($SkipSchema) { 'SKIPPED' } elseif ($schemaOk) { 'OK' } else { 'DRIFT' }
    }
  }
  catch {
    $failures.Add("$tableName could not be read: $($_.Exception.Message)")
    [pscustomobject]@{
      Table = $tableName
      Status = 'MISSING/ERROR'
      Billing = ''
      Keys = ''
      GSI = ''
      Schema = 'ERROR'
    }
  }
}

$rows | Format-Table -AutoSize

if ($failures.Count -gt 0) {
  Write-Host ''
  Write-Error ("Data foundation verification failed:`n- " + ($failures -join "`n- "))
  exit 1
}

Write-Host ''
Write-Host 'CampusMeet data foundation verification passed.'
