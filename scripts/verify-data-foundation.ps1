[CmdletBinding()]
param(
  [string]$Profile,
  [string]$Region = 'ap-southeast-1',
  [string]$TablePrefix = 'campusmeet-dev',
  [string]$ExpectedAccountId = '604360241374'
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

$expected = @(
  @{ Name = "$TablePrefix-identity"; Gsis = @('GSI1', 'GSI2') }
  @{ Name = "$TablePrefix-collaboration"; Gsis = @('GSI1', 'GSI2') }
  @{ Name = "$TablePrefix-meeting-data"; Gsis = @('GSI1', 'GSI2', 'GSI3') }
  @{ Name = "$TablePrefix-task-data"; Gsis = @('GSI1', 'GSI2', 'GSI3') }
  @{ Name = "$TablePrefix-ai-work"; Gsis = @('GSI1', 'GSI2') }
)

$identity = Invoke-AwsJson -Arguments @('sts', 'get-caller-identity')
if ($ExpectedAccountId -and $identity.Account -ne $ExpectedAccountId) {
  throw "Wrong AWS account. Expected $ExpectedAccountId but authenticated as $($identity.Account)."
}

Write-Host "Account: $($identity.Account)"
Write-Host "Region:  $Region"
Write-Host "Prefix:  $TablePrefix"
Write-Host ''

$failures = [System.Collections.Generic.List[string]]::new()
$rows = foreach ($item in $expected) {
  try {
    $response = Invoke-AwsJson -Arguments @('dynamodb', 'describe-table', '--table-name', $item.Name)
    $table = $response.Table
    $hash = ($table.KeySchema | Where-Object KeyType -eq 'HASH').AttributeName
    $range = ($table.KeySchema | Where-Object KeyType -eq 'RANGE').AttributeName
    $gsis = @($table.GlobalSecondaryIndexes | ForEach-Object IndexName | Sort-Object)
    $expectedGsis = @($item.Gsis | Sort-Object)

    $ttl = Invoke-AwsJson -Arguments @('dynamodb', 'describe-time-to-live', '--table-name', $item.Name)
    $tags = Invoke-AwsJson -Arguments @('dynamodb', 'list-tags-of-resource', '--resource-arn', $table.TableArn)
    $modelTag = ($tags.Tags | Where-Object Key -eq 'DataModelVersion').Value

    if ($table.TableStatus -ne 'ACTIVE') {
      $failures.Add("$($item.Name) is $($table.TableStatus), not ACTIVE.")
    }
    if ($table.BillingModeSummary.BillingMode -ne 'PAY_PER_REQUEST') {
      $failures.Add("$($item.Name) is not PAY_PER_REQUEST.")
    }
    if ($hash -ne 'PK' -or $range -ne 'SK') {
      $failures.Add("$($item.Name) must use PK/SK. Actual HASH=$hash RANGE=$range.")
    }
    if (($gsis -join ',') -ne ($expectedGsis -join ',')) {
      $failures.Add("$($item.Name) GSI mismatch. Expected [$($expectedGsis -join ', ')], actual [$($gsis -join ', ')].")
    }
    if ($ttl.TimeToLiveDescription.TimeToLiveStatus -notin @('ENABLED', 'ENABLING')) {
      $failures.Add("$($item.Name) TTL is not enabled.")
    }
    if ($ttl.TimeToLiveDescription.AttributeName -ne 'expiresAtEpoch') {
      $failures.Add("$($item.Name) TTL attribute must be expiresAtEpoch.")
    }
    if ($modelTag -ne '2') {
      $failures.Add("$($item.Name) is missing DataModelVersion=2 tag.")
    }

    [pscustomobject]@{
      Table = $item.Name
      Status = $table.TableStatus
      Billing = $table.BillingModeSummary.BillingMode
      Keys = "$hash/$range"
      GSI = $gsis.Count
      TTL = $ttl.TimeToLiveDescription.TimeToLiveStatus
      Model = $modelTag
      Items = $table.ItemCount
    }
  }
  catch {
    $failures.Add("$($item.Name) could not be verified: $($_.Exception.Message)")
    [pscustomobject]@{
      Table = $item.Name
      Status = 'MISSING/ERROR'
      Billing = ''
      Keys = ''
      GSI = ''
      TTL = ''
      Model = ''
      Items = ''
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
Write-Host 'CampusMeet DynamoDB v2 verification passed.'
