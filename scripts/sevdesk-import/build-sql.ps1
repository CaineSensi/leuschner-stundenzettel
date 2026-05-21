# Baut aus den JSON-Snapshots in data\ einen idempotenten SQL-Block.
# Output: out\import-YYYY-MM-DD.sql
#
# Reihenfolge im Block:
#   1. Schema-Vorbereitung (site_invoices-Tabelle + Unique-Constraints)
#   2. customers-Tabelle (aus migrations/20260521120000_customers.sql)
#   3. INSERT customers ON CONFLICT (sevdesk_contact_id)
#   4. INSERT sites für angenommene Aufträge (status=1000), WHERE NOT EXISTS
#   5. INSERT pipeline_cards ON CONFLICT (sevdesk_order_id) — Stage-Mapping
#   6. INSERT site_invoices ON CONFLICT (sevdesk_invoice_id)

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$dataDir  = Join-Path $PSScriptRoot 'data'
$outDir   = Join-Path $PSScriptRoot 'out'
$migrDir  = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'supabase\migrations'

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$orders    = Get-Content (Join-Path $dataDir 'orders.json')    -Raw -Encoding UTF8 | ConvertFrom-Json
$invoices  = Get-Content (Join-Path $dataDir 'invoices.json')  -Raw -Encoding UTF8 | ConvertFrom-Json
$contacts  = Get-Content (Join-Path $dataDir 'contacts.json')  -Raw -Encoding UTF8 | ConvertFrom-Json
$addresses = Get-Content (Join-Path $dataDir 'addresses.json') -Raw -Encoding UTF8 | ConvertFrom-Json

$companyId = '00000000-0000-0000-0000-000000000001'

function Q($v) {
  if ($null -eq $v) { return 'null' }
  $s = [string]$v
  if ([string]::IsNullOrEmpty($s)) { return 'null' }
  return "'" + $s.Replace("'", "''") + "'"
}
function N($v) {
  if ($null -eq $v -or [string]::IsNullOrEmpty([string]$v)) { return 'null' }
  $d = [decimal]::Parse([string]$v, [System.Globalization.CultureInfo]::InvariantCulture)
  return $d.ToString([System.Globalization.CultureInfo]::InvariantCulture)
}
function D($iso) {
  if ($null -eq $iso -or [string]::IsNullOrEmpty([string]$iso)) { return 'null' }
  $dt = [datetime]::Parse([string]$iso)
  return "'" + $dt.ToString('yyyy-MM-dd') + "'"
}
function B($v) {
  if ($null -eq $v) { return 'false' }
  if ($v -is [bool]) { return $(if ($v) { 'true' } else { 'false' }) }
  $s = [string]$v
  if ($s -eq '1' -or $s -eq 'true') { return 'true' }
  return 'false'
}

# ContactAddresses je contact_id (erste Adresse gewinnt)
$addrByContact = @{}
foreach ($a in $addresses) {
  $cid = [string]$a.contact.id
  if (-not $addrByContact.ContainsKey($cid)) { $addrByContact[$cid] = $a }
}

# Invoice → Order-Nummer (aus Header parsen) ODER direkt aus invoice.order
$invoiceToOrder = @{}
foreach ($i in $invoices) {
  $orderNum = $null
  if ($i.PSObject.Properties['order'] -and $i.order -and $i.order.id) {
    # falls sevDesk eine direkte order-Referenz mitgibt
    $matching = $orders | Where-Object { [string]$_.id -eq [string]$i.order.id } | Select-Object -First 1
    if ($matching) { $orderNum = [string]$matching.orderNumber }
  }
  if (-not $orderNum -and $i.header) {
    if ([string]$i.header -match 'AN-(\d+)') { $orderNum = 'AN-' + $Matches[1] }
  }
  if ($orderNum) { $invoiceToOrder[[string]$i.id] = $orderNum }
}

# Welche Orders haben Invoices?
$orderHasInvoice = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($pair in $invoiceToOrder.GetEnumerator()) {
  [void]$orderHasInvoice.Add($pair.Value)
}

# SQL bauen
$sb = New-Object System.Text.StringBuilder
function W { param([string]$s); [void]$sb.AppendLine($s) }

W "-- ============================================================"
W "-- sevDesk → Supabase Initial-Import"
W ("-- Generiert: {0}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
W ("-- Quelle:    {0} Aufträge, {1} Rechnungen, {2} Kunden" -f $orders.Count, $invoices.Count, $contacts.Count)
W "-- Idempotent — kann mehrfach ausgeführt werden."
W "-- ============================================================"
W ""

# ---- Schema: customers-Migration inline (falls noch nicht live) ----
W "-- 1) Schema customers + site_invoices (idempotent)"
W ""
$customersMig = Get-Content (Join-Path $migrDir '20260521120000_customers.sql') -Raw -Encoding UTF8
W $customersMig
W ""

$siteInvMig = Get-Content (Join-Path $migrDir '20260512140000_site_invoices.sql') -Raw -Encoding UTF8
# UNIQUE auf sevdesk_invoice_id ergänzen (für ON CONFLICT)
W $siteInvMig
W ""
W "create unique index if not exists site_invoices_sevdesk_uniq"
W "  on site_invoices(sevdesk_invoice_id) where sevdesk_invoice_id is not null;"
W "create unique index if not exists pipeline_cards_sevdesk_order_uniq"
W "  on pipeline_cards(sevdesk_order_id) where sevdesk_order_id is not null;"
W "create unique index if not exists sites_sevdesk_order_uniq"
W "  on sites(sevdesk_order_number) where sevdesk_order_number is not null;"
W ""

# ---- 2) Customers ----
W "-- 2) Customers ({0} Datensätze)" -f $contacts.Count
W "insert into customers (company_id, sevdesk_contact_id, customer_number, name, surename, familyname, is_company, email, phone, street, zip, city, country)"
W "values"
$rows = @()
foreach ($c in $contacts) {
  $addr = $addrByContact[[string]$c.id]
  $isCompany = $false
  $displayName = ''
  if ($c.name) { $isCompany = $true; $displayName = [string]$c.name }
  else { $displayName = (($c.surename, $c.familyname) | Where-Object { $_ }) -join ' ' }
  if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = "Kunde $($c.customerNumber)" }

  $email = $null; $phone = $null
  # sevDesk-Contact hat email/phone in CommunicationWay — nicht in der Standard-Response. Lassen wir leer.

  $street = if ($addr) { [string]$addr.street } else { $null }
  $zip    = if ($addr) { [string]$addr.zip }    else { $null }
  $city   = if ($addr) { [string]$addr.city }   else { $null }

  $rows += "  ($(Q $companyId), $(Q $c.id), $(Q $c.customerNumber), $(Q $displayName), $(Q $c.surename), $(Q $c.familyname), $(B $isCompany), $(Q $email), $(Q $phone), $(Q $street), $(Q $zip), $(Q $city), 'Deutschland')"
}
W ($rows -join ",`n")
W "on conflict (sevdesk_contact_id) where sevdesk_contact_id is not null"
W "do update set"
W "  customer_number = excluded.customer_number,"
W "  name            = excluded.name,"
W "  surename        = excluded.surename,"
W "  familyname      = excluded.familyname,"
W "  is_company      = excluded.is_company,"
W "  street          = coalesce(excluded.street, customers.street),"
W "  zip             = coalesce(excluded.zip, customers.zip),"
W "  city            = coalesce(excluded.city, customers.city);"
W ""

# ---- 3) Sites für angenommene Aufträge ----
$accepted = $orders | Where-Object { [int]$_.status -eq 1000 }
W "-- 3) Auto-Sites für angenommene Aufträge ({0}, status=1000)" -f $accepted.Count
foreach ($o in $accepted) {
  $contact = $contacts | Where-Object { [string]$_.id -eq [string]$o.contact.id } | Select-Object -First 1
  $custName = if ($contact) {
    if ($contact.name) { [string]$contact.name }
    else { (($contact.surename, $contact.familyname) | Where-Object { $_ }) -join ' ' }
  } else { 'Unbekannt' }
  $orderNum = [string]$o.orderNumber
  $siteName = "$custName · $orderNum"
  # Adresse aus order.address parsen (falls vorhanden) — sonst aus Contact-Adresse
  $street = $null; $zip = $null; $city = $null
  if ($o.address) {
    $parts = [string]$o.address -split "`n"
    if ($parts.Count -ge 3) {
      $street = $parts[1]
      $cityLine = $parts[2]
      if ($cityLine -match '^(\d{4,5})\s+(.+)$') { $zip = $Matches[1]; $city = $Matches[2] }
      else { $city = $cityLine }
    }
  }
  if (-not $street -and $contact) {
    $a = $addrByContact[[string]$contact.id]
    if ($a) { $street = [string]$a.street; $zip = [string]$a.zip; $city = [string]$a.city }
  }

  W "insert into sites (company_id, name, street, city, zip, customer_name, sevdesk_contact_id, sevdesk_order_number, estimate_net_eur, customer_id)"
  W "select $(Q $companyId), $(Q $siteName), $(Q $street), $(Q $city), $(Q $zip), $(Q $custName), $(Q $o.contact.id), $(Q $orderNum), $(N $o.sumNet),"
  W "       (select id from customers where sevdesk_contact_id = $(Q $o.contact.id))"
  W "where not exists (select 1 from sites where sevdesk_order_number = $(Q $orderNum));"
}
W ""

# ---- 4) Pipeline-Cards ----
W "-- 4) Pipeline-Cards ({0} Aufträge → Karten)" -f $orders.Count
W "delete from pipeline_cards where company_id = $(Q $companyId) and sevdesk_order_id is null;"
W "-- (alte manuelle Seed-Karten ohne sevDesk-Link löschen, damit das Board nicht doppelt zeigt)"
W ""
foreach ($o in $orders) {
  $contact = $contacts | Where-Object { [string]$_.id -eq [string]$o.contact.id } | Select-Object -First 1
  $custName = if ($contact) {
    if ($contact.name) { [string]$contact.name }
    else { (($contact.surename, $contact.familyname) | Where-Object { $_ }) -join ' ' }
  } else { 'Unbekannt' }
  $orderNum = [string]$o.orderNumber
  $status   = [int]$o.status

  $stage = switch ($status) {
    100  { 'Angebot' }    # Entwurf, noch nicht raus
    200  { 'Versendet' }  # raus beim Kunden, Nachfass-Stage
    1000 { if ($orderHasInvoice.Contains($orderNum)) { 'Abgerechnet' } else { 'Auftrag' } }
    default { 'Angebot' }
  }
  $openPoints = $null
  if ($status -eq 100) {
    $openPoints = 'Entwurf · noch nicht versendet'
  } elseif ($status -eq 200) {
    if ($o.sendDate) {
      $sentStr = ([datetime]$o.sendDate).ToString('yyyy-MM-dd')
      $days = [int]((Get-Date) - [datetime]$o.sendDate).TotalDays
      $openPoints = if ($days -ge 7) { "versendet $sentStr · Nachfass-Bedarf ($days Tage)" } else { "versendet $sentStr" }
    } else { $openPoints = 'versendet' }
  } elseif ($status -eq 1000) {
    $openPoints = if ($orderHasInvoice.Contains($orderNum)) { 'bezahlt' } else { 'angenommen · Baustelle laeuft' }
  }

  # Ort aus order.address
  $place = $null
  if ($o.address) {
    $parts = [string]$o.address -split "`n"
    if ($parts.Count -ge 3) { $place = $parts[2] }
  }

  # Beschreibung: header oder leer
  $desc = $null
  if ($o.header) {
    $desc = [string]$o.header -replace '^Angebot\s+AN-\d+\s*[-·]\s*', ''
    if ([string]::IsNullOrWhiteSpace($desc)) { $desc = [string]$o.header }
  }

  $validUntil = if ($status -in 100,200) {
    "(date " + $(D $o.orderDate) + " + interval '28 days')::date"
  } else { 'null' }

  # Rechnung dazu?
  $invForOrder = $invoiceToOrder.GetEnumerator() | Where-Object { $_.Value -eq $orderNum } | Select-Object -First 1
  $invoiceIdRef = if ($invForOrder) { Q $invForOrder.Key } else { 'null' }
  $invoiceDocNum = if ($invForOrder) {
    $i = $invoices | Where-Object { [string]$_.id -eq $invForOrder.Key } | Select-Object -First 1
    if ($i) { Q $i.invoiceNumber } else { 'null' }
  } else { 'null' }

  $docNum = if ($stage -eq 'Abgerechnet' -and $invoiceDocNum -ne 'null') { $invoiceDocNum } else { Q $orderNum }

  W "insert into pipeline_cards (company_id, stage, customer_name, customer_id, place, description, value_eur, plan_eur, open_points, doc_number, sevdesk_order_id, sevdesk_invoice_id, site_id, valid_until, sort_order)"
  W "values ($(Q $companyId), $(Q $stage), $(Q $custName),"
  W "        (select id from customers where sevdesk_contact_id = $(Q $o.contact.id)),"
  W "        $(Q $place), $(Q $desc), $(N $o.sumNet), $(N $o.sumNet), $(Q $openPoints),"
  W "        $docNum, $(Q $o.id), $invoiceIdRef,"
  W "        (select id from sites where sevdesk_order_number = $(Q $orderNum)),"
  W "        $validUntil, 0)"
  W "on conflict (sevdesk_order_id) where sevdesk_order_id is not null"
  W "do update set"
  W "  stage           = excluded.stage,"
  W "  customer_name   = excluded.customer_name,"
  W "  customer_id     = excluded.customer_id,"
  W "  place           = coalesce(excluded.place, pipeline_cards.place),"
  W "  description     = coalesce(excluded.description, pipeline_cards.description),"
  W "  value_eur       = excluded.value_eur,"
  W "  plan_eur        = excluded.plan_eur,"
  W "  open_points     = excluded.open_points,"
  W "  doc_number      = excluded.doc_number,"
  W "  sevdesk_invoice_id = excluded.sevdesk_invoice_id,"
  W "  site_id         = coalesce(excluded.site_id, pipeline_cards.site_id),"
  W "  valid_until     = excluded.valid_until;"
}
W ""

# ---- 5) Site-Invoices ----
W "-- 5) Site-Invoices ({0} Rechnungen)" -f $invoices.Count
foreach ($i in $invoices) {
  $orderNum = $invoiceToOrder[[string]$i.id]
  $status   = [int]$i.status
  $statusStr = switch ($status) {
    100  { 'draft' }
    200  { 'open' }
    1000 { 'paid' }
    default { 'open' }
  }
  $siteRef = if ($orderNum) {
    "(select id from sites where sevdesk_order_number = $(Q $orderNum))"
  } else { 'null' }

  # Falls keine Site verlinkbar (z. B. Rechnung ohne Angebot/AN aus alten Zeiten),
  # legen wir eine Stub-Site auf den Kunden an, sonst klappt der FK nicht.
  W "do `$do`$ declare _site uuid;"
  W "begin"
  W "  -- 1. bereits importierte Rechnung wiederfinden (Idempotenz)"
  W "  _site := (select site_id from site_invoices where sevdesk_invoice_id = $(Q $i.id));"
  if ($orderNum) {
    W "  -- 2. via verknüpfter Order-Baustelle"
    W "  if _site is null then _site := (select id from sites where sevdesk_order_number = $(Q $orderNum)); end if;"
  }
  W "  -- 3. Stub-Baustelle für Altrechnung anlegen, falls Kunde bekannt"
  W "  if _site is null then"
  W "    insert into sites (company_id, name, customer_name, sevdesk_contact_id, customer_id)"
  W "    select $(Q $companyId), 'Rechnung ' || $(Q $i.invoiceNumber),"
  W "           (select coalesce(name, surename || ' ' || familyname) from customers where sevdesk_contact_id = $(Q $i.contact.id)),"
  W "           $(Q $i.contact.id),"
  W "           (select id from customers where sevdesk_contact_id = $(Q $i.contact.id))"
  W "    where exists (select 1 from customers where sevdesk_contact_id = $(Q $i.contact.id))"
  W "    returning id into _site;"
  W "  end if;"
  W "  if _site is not null then"
  W "    insert into site_invoices (site_id, invoice_number, invoice_date, status, net_eur, gross_eur, sevdesk_invoice_id)"
  W "    values (_site, $(Q $i.invoiceNumber), $(D $i.invoiceDate), $(Q $statusStr), $(N $i.sumNet), $(N $i.sumGross), $(Q $i.id))"
  W "    on conflict (sevdesk_invoice_id) where sevdesk_invoice_id is not null"
  W "    do update set status = excluded.status, net_eur = excluded.net_eur, gross_eur = excluded.gross_eur, invoice_date = excluded.invoice_date;"
  W "  end if;"
  W "end `$do`$;"
}
W ""
W "-- ============================================================"
W "-- Verifikation:"
W "--   select stage, count(*) from pipeline_cards group by stage;"
W "--   select count(*) from customers;       -- erwartet: $($contacts.Count)"
W "--   select count(*) from site_invoices;   -- erwartet: $($invoices.Count)"
W "-- ============================================================"

$outFile = Join-Path $outDir ("import-{0}.sql" -f (Get-Date).ToString('yyyy-MM-dd'))
[System.IO.File]::WriteAllText($outFile, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Host "Geschrieben: $outFile  ($([math]::Round((Get-Item $outFile).Length / 1024, 1)) KB)" -ForegroundColor Green
