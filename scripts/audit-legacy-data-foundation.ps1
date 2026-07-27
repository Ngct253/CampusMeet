[CmdletBinding()]
param(
  [string]$Profile,
  [string]$Region = 'ap-southeast-1',
  [string]$TablePrefix = 'campusmeet-dev',
  [string]$ExpectedAccountId = '604360241374',
  [string]$ExportCsv
)

$ErrorActionPreference = 'Stop'

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
  if (-not $raw) { return $null }
  return ($raw | ConvertFrom-Json)
}

$legacySuffixes = @(
  'users',
  'groups',
  'memberships',
  'invitations',
  'meetings',
  'reminders',
  'minutes',
  'tasks',
  'notifications',
  'audit-logs',
  'attachments',
  'recordings',
  'recording-consents',
  'transcripts',
  'ai-jobs',
  'ai-conversations',
  'tool-proposals'
)

$identity = Invoke-AwsJson -Arguments @('sts', 'get-caller-identity')
if ($ExpectedAccountId -and $identity.Account -ne $ExpectedAccountId) {
  throw "Wrong AWS account. Expected $ExpectedAccountId but authenticated as $($identity.Account)."
}

Write-Host 'READ-ONLY legacy audit. This script never deletes or modifies a table.'
Write-Host "Account: $($identity.Account)"
Write-Host "Region:  $Region"
Write-Host ''

$rows = foreach ($suffix in $legacySuffixes) {
  $name = "$TablePrefix-$suffix"
  try {
    $response = Invoke-AwsJson -Arguments @('dynamodb', 'describe-table', '--table-name', $name)
    $table = $response.Table
    $pitr = Invoke-AwsJson -Arguments @('dynamodb', 'describe-continuous-backups', '--table-name', $name)
    $ttl = Invoke-AwsJson -Arguments @('dynamodb', 'describe-time-to-live', '--table-name', $name)

    [pscustomobject]@{
      Table = $name
      Exists = $true
      Status = $table.TableStatus
      ItemsApprox = $table.ItemCount
      SizeBytesApprox = $table.TableSizeBytes
      Billing = $table.BillingModeSummary.BillingMode
      PITR = $pitr.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus
      TTL = $ttl.TimeToLiveDescription.TimeToLiveStatus
      DeletionProtection = $table.DeletionProtectionEnabled
      Arn = $table.TableArn
    }
  }
  catch {
    [pscustomobject]@{
      Table = $name
      Exists = $false
      Status = 'MISSING/ERROR'
      ItemsApprox = ''
      SizeBytesApprox = ''
      Billing = ''
      PITR = ''
      TTL = ''
      DeletionProtection = ''
      Arn = ''
    }
  }
}

$rows | Format-Table Table, Exists, Status, ItemsApprox, SizeBytesApprox, PITR, DeletionProtection -AutoSize

if ($ExportCsv) {
  $rows | Export-Csv -Path $ExportCsv -NoTypeInformation -Encoding UTF8
  Write-Host "`nSaved audit report to $ExportCsv"
}

$nonEmpty = @($rows | Where-Object { $_.Exists -and [int64]$_.ItemsApprox -gt 0 })
Write-Host ''
if ($nonEmpty.Count -gt 0) {
  Write-Warning "$($nonEmpty.Count) legacy table(s) report ItemCount > 0. Do not delete them before backup and data migration review."
} else {
  Write-Host 'No legacy table currently reports ItemCount > 0. ItemCount is approximate; verify business usage and backups before deletion.'
}
