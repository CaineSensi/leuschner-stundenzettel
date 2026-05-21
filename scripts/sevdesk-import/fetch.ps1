# Holt sevDesk-Stammdaten als JSON-Snapshots nach data\.
# Voraussetzung: $env:SEVDESK_TOKEN gesetzt (Wert aus E:\Leuschner APP\SEVDESK.md).
#
# Filter:
#   - Orders: alle Status außer 300/500 (verworfen), nur orderDate >= 2026-01-01
#   - Invoices: alle (sevDesk-Bestand aktuell nur paid)
#   - Contacts: alle, danach gefiltert auf die in Orders/Invoices referenzierten
#
# Output:
#   data\orders.json
#   data\invoices.json
#   data\contacts.json
#   data\fetch-meta.json   (Zeitstempel + Counts für Verifikation)

[CmdletBinding()]
param(
  [string]$Since = '2026-01-01',
  [int[]]$ExcludeOrderStatus = @(300, 500),
  [int]$PageSize = 200
)

$ErrorActionPreference = 'Stop'
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

if (-not $env:SEVDESK_TOKEN) {
  throw "SEVDESK_TOKEN nicht gesetzt. In dieser Shell: `$env:SEVDESK_TOKEN = '<token>'"
}

$base = 'https://my.sevdesk.de/api/v1'
$h = @{
  Authorization = $env:SEVDESK_TOKEN
  Accept        = 'application/json'
}

$dataDir = Join-Path $PSScriptRoot 'data'
if (-not (Test-Path $dataDir)) {
  New-Item -ItemType Directory -Path $dataDir | Out-Null
}

function Get-AllPaged {
  param([string]$Endpoint, [hashtable]$Query = @{})
  $offset = 0
  $all = New-Object System.Collections.ArrayList
  while ($true) {
    $q = @{ limit = $PageSize; offset = $offset; depth = 1 }
    foreach ($k in $Query.Keys) { $q[$k] = $Query[$k] }
    $qs = ($q.GetEnumerator() | ForEach-Object { "$($_.Key)=$([uri]::EscapeDataString([string]$_.Value))" }) -join '&'
    $url = "$base/$Endpoint`?$qs"
    Write-Host "GET $Endpoint offset=$offset" -ForegroundColor DarkGray
    $r = Invoke-RestMethod -Uri $url -Headers $h
    if (-not $r.objects -or $r.objects.Count -eq 0) { break }
    [void]$all.AddRange($r.objects)
    if ($r.objects.Count -lt $PageSize) { break }
    $offset += $PageSize
  }
  return ,$all.ToArray()
}

Write-Host "==> Hole Orders ab $Since" -ForegroundColor Cyan
$allOrders = Get-AllPaged -Endpoint 'Order'
$orders = $allOrders | Where-Object {
  $od = [datetime]::Parse($_.orderDate)
  $od -ge [datetime]::Parse($Since) -and ($ExcludeOrderStatus -notcontains [int]$_.status)
}
Write-Host ("  Gesamt: {0}, gefiltert: {1}" -f $allOrders.Count, $orders.Count)

Write-Host "==> Hole Invoices ab $Since" -ForegroundColor Cyan
$allInvoices = Get-AllPaged -Endpoint 'Invoice'
$invoices = $allInvoices | Where-Object {
  [datetime]::Parse($_.invoiceDate) -ge [datetime]::Parse($Since)
}
Write-Host ("  Gesamt: {0}, gefiltert: {1}" -f $allInvoices.Count, $invoices.Count)

Write-Host "==> Hole Contacts" -ForegroundColor Cyan
$allContacts = Get-AllPaged -Endpoint 'Contact'
Write-Host ("  Gesamt: {0}" -f $allContacts.Count)

# Contacts auf die in Orders/Invoices referenzierten reduzieren
$contactIds = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($o in $orders)   { if ($o.contact.id)   { [void]$contactIds.Add([string]$o.contact.id) } }
foreach ($i in $invoices) { if ($i.contact.id)   { [void]$contactIds.Add([string]$i.contact.id) } }
$contacts = $allContacts | Where-Object { $contactIds.Contains([string]$_.id) }
Write-Host ("  Referenziert: {0}" -f $contacts.Count)

# Auch ContactAddresses ziehen — sevDesk hat Adresse separat
Write-Host "==> Hole ContactAddresses" -ForegroundColor Cyan
$addresses = Get-AllPaged -Endpoint 'ContactAddress'
$addresses = $addresses | Where-Object { $_.contact -and $contactIds.Contains([string]$_.contact.id) }
Write-Host ("  Referenziert: {0}" -f $addresses.Count)

# Serialisieren
function Write-Json {
  param([string]$Path, $Obj)
  $json = $Obj | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

Write-Json (Join-Path $dataDir 'orders.json')    $orders
Write-Json (Join-Path $dataDir 'invoices.json')  $invoices
Write-Json (Join-Path $dataDir 'contacts.json')  $contacts
Write-Json (Join-Path $dataDir 'addresses.json') $addresses

$meta = [ordered]@{
  fetched_at         = (Get-Date).ToString('o')
  since              = $Since
  excluded_status    = $ExcludeOrderStatus
  counts             = [ordered]@{
    orders_total     = $allOrders.Count
    orders_filtered  = $orders.Count
    invoices         = $invoices.Count
    contacts_total   = $allContacts.Count
    contacts_used    = $contacts.Count
    addresses_used   = $addresses.Count
  }
  status_breakdown   = ($orders | Group-Object status |
                         ForEach-Object { @{ status = [int]$_.Name; count = $_.Count } })
}
Write-Json (Join-Path $dataDir 'fetch-meta.json') $meta

Write-Host ""
Write-Host "Fertig. Snapshots in $dataDir" -ForegroundColor Green
Write-Host "  orders:    $($orders.Count)"
Write-Host "  invoices:  $($invoices.Count)"
Write-Host "  contacts:  $($contacts.Count)"
Write-Host "  addresses: $($addresses.Count)"
