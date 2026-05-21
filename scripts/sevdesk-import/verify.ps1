# Verifikation nach dem Live-Apply. Vergleicht Zeilenzahlen Live-DB
# gegen die Fetch-Snapshots in data\fetch-meta.json.

$ErrorActionPreference = 'Stop'
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

$sbUrl = 'https://vejhsyrxpveunygyhqlo.supabase.co'
$sbKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlamhzeXJ4cHZldW55Z3locWxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMjA0NzMsImV4cCI6MjA5MzU5NjQ3M30.Cfz0mVTEsdPVpd9K137h_DhL6LmlGS5rjRahp42k9jQ'
$h = @{ apikey = $sbKey; Authorization = "Bearer $sbKey"; Accept = 'application/json' }

$meta = Get-Content (Join-Path $PSScriptRoot 'data\fetch-meta.json') -Raw -Encoding UTF8 | ConvertFrom-Json

function Count-Rows([string]$table) {
  $r = Invoke-WebRequest -Uri "$sbUrl/rest/v1/$table`?select=id&limit=1" -Headers ($h + @{ Prefer = 'count=exact' }) -UseBasicParsing
  $range = $r.Headers['Content-Range']
  if ($range -match '/(\d+)$') { return [int]$Matches[1] }
  return -1
}

$cust = Count-Rows 'customers'
$cards = Count-Rows 'pipeline_cards'
$inv  = Count-Rows 'site_invoices'
$sites = Count-Rows 'sites'

Write-Host ""
Write-Host "Verifikation Live-DB vs. Fetch-Snapshot" -ForegroundColor Cyan
Write-Host ("  customers:      {0} live  ({1} im Snapshot)" -f $cust, $meta.counts.contacts_used)
Write-Host ("  pipeline_cards: {0} live  ({1} im Snapshot)" -f $cards, $meta.counts.orders_filtered)
Write-Host ("  site_invoices:  {0} live  ({1} im Snapshot)" -f $inv, $meta.counts.invoices)
Write-Host ("  sites:          {0} live" -f $sites)

if ($cust -eq $meta.counts.contacts_used -and $cards -ge $meta.counts.orders_filtered -and $inv -eq $meta.counts.invoices) {
  Write-Host ""
  Write-Host "OK - Import scheint vollstaendig." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "ACHTUNG - Zaehler weichen ab." -ForegroundColor Yellow
}
