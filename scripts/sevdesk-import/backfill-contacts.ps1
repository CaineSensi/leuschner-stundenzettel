# Backfill: email + phone aus sevDesk CommunicationWay in die App-customers-Tabelle.
#
# Hintergrund: Der Initial-Import (build-sql.ps1) hat email/phone leer gelassen.
# Dadurch feuern die staerksten Match-Anker (E-Mail exakt 70 P., Telefon 60 P.)
# in der Anfragen-Kundenerkennung NIE. Dieses Skript holt die CommunicationWays
# (EMAIL/PHONE/MOBILE) je Contact und erzeugt ein idempotentes UPDATE-SQL fuer
# den Supabase-Dashboard-SQL-Editor (Anon-Write ist seit RLS-Haertung tot).
#
# Nutzung:
#   $env:SEVDESK_TOKEN = '<token aus KeePass: "sevDesk Leuschner">'
#   ./backfill-contacts.ps1
# Danach: out/backfill-contacts-YYYY-MM-DD.sql im Dashboard ausfuehren.

[CmdletBinding()]
param(
  [string]$Token = $env:SEVDESK_TOKEN
)

$ErrorActionPreference = 'Stop'
if (-not $Token) { throw 'Kein sevDesk-Token. $env:SEVDESK_TOKEN setzen (KeePass-Eintrag "sevDesk Leuschner").' }

$base = 'https://my.sevdesk.de/api/v1'
$h = @{ Authorization = $Token; Accept = 'application/json' }
$outDir = Join-Path $PSScriptRoot 'out'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# Alle CommunicationWays paginiert ziehen
$cws = @()
$offset = 0
do {
  $page = Invoke-RestMethod -Uri "$base/CommunicationWay?limit=1000&offset=$offset" -Headers $h
  if ($page.objects) { $cws += $page.objects }
  $offset += 1000
} while ($page.objects -and $page.objects.Count -eq 1000)

Write-Host "CommunicationWays geladen: $($cws.Count)" -ForegroundColor Cyan

# je Contact: beste E-Mail + bestes Telefon bestimmen
# Telefon-Praeferenz: main=1 > MOBILE > PHONE
$byContact = @{}
foreach ($cw in $cws) {
  $cid = [string]$cw.contact.id
  if (-not $cid) { continue }
  if (-not $byContact.ContainsKey($cid)) { $byContact[$cid] = @{ email = $null; phone = $null; emailMain = $false; phoneRank = -1 } }
  $rec = $byContact[$cid]
  $val = [string]$cw.value
  if ([string]::IsNullOrWhiteSpace($val)) { continue }
  $isMain = ([string]$cw.main -eq '1')
  switch ([string]$cw.type) {
    'EMAIL' {
      if ($null -eq $rec.email -or ($isMain -and -not $rec.emailMain)) { $rec.email = $val.Trim(); $rec.emailMain = $isMain }
    }
    { $_ -in 'PHONE','MOBILE','LANDLINE' } {
      # Rang: main=3, MOBILE=2, PHONE/sonst=1
      $rank = if ($isMain) { 3 } elseif ($_ -eq 'MOBILE') { 2 } else { 1 }
      if ($rank -gt $rec.phoneRank) { $rec.phone = $val.Trim(); $rec.phoneRank = $rank }
    }
  }
}

function SqlStr([string]$s) {
  if ($null -eq $s -or [string]::IsNullOrWhiteSpace($s)) { return 'null' }
  return "'" + $s.Replace("'", "''") + "'"
}

$rows = @()
foreach ($kv in $byContact.GetEnumerator()) {
  $cid = $kv.Key
  $rec = $kv.Value
  if (-not $rec.email -and -not $rec.phone) { continue }
  $emailLower = if ($rec.email) { $rec.email.ToLowerInvariant() } else { $null }
  $rows += "  ($(SqlStr $cid), $(SqlStr $emailLower), $(SqlStr $rec.phone))"
}

$sb = New-Object System.Text.StringBuilder
function W { param([string]$s); [void]$sb.AppendLine($s) }
W "-- ============================================================"
W "-- Backfill: email + phone in customers aus sevDesk CommunicationWay"
W ("-- Generiert: {0}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
W ("-- Kunden mit Kontaktdaten: {0}" -f $rows.Count)
W "-- Idempotent: coalesce schuetzt vorhandene Werte vor null-Ueberschreiben."
W "-- Im Supabase-Dashboard-SQL-Editor ausfuehren."
W "-- ============================================================"
W "update customers c set"
W "  email = coalesce(v.email, c.email),"
W "  phone = coalesce(v.phone, c.phone)"
W "from (values"
W ($rows -join ",`n")
W ") as v(sevdesk_contact_id, email, phone)"
W "where c.sevdesk_contact_id = v.sevdesk_contact_id"
W "  and (c.email is distinct from coalesce(v.email, c.email)"
W "       or c.phone is distinct from coalesce(v.phone, c.phone));"
W ""
W "-- Verifikation:"
W "select count(*) filter (where email is not null) as mit_email,"
W "       count(*) filter (where phone is not null) as mit_phone,"
W "       count(*) as gesamt"
W "from customers;"

$outFile = Join-Path $outDir ("backfill-contacts-{0}.sql" -f (Get-Date).ToString('yyyy-MM-dd'))
[System.IO.File]::WriteAllText($outFile, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Host "Geschrieben: $outFile  ($($rows.Count) Kunden mit Kontaktdaten)" -ForegroundColor Green
