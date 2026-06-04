-- Atomare Anlage einer Anfrage als EIN Vorgang: Kunde (neu oder bestehend),
-- Pipeline-Karte, Inquiry und Baustelle entstehen gemeinsam — oder gar nicht.
-- Verhindert halbe Zustände (z.B. Karte ohne Anfrage) und – zusammen mit der
-- idempotenten sevDesk-Anlage im Frontend – verwaiste sevDesk-Kontakte.
--
-- SECURITY INVOKER: läuft mit den Rechten des angemeldeten Nutzers, die
-- bestehenden Schutzregeln (RLS) greifen also unverändert. Ohne gültige
-- Admin-Anmeldung bricht die Funktion sauber ab, BEVOR irgendetwas entsteht.

create or replace function public.create_inquiry_bundle(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company  uuid := current_company_id();
  v_customer uuid := nullif(payload->>'customer_id', '')::uuid;
  v_card     uuid;
  v_inquiry  uuid;
  v_site     uuid;
  c jsonb := coalesce(payload->'customer', '{}'::jsonb);
  k jsonb := coalesce(payload->'card',     '{}'::jsonb);
  i jsonb := coalesce(payload->'inquiry',  '{}'::jsonb);
  s jsonb := coalesce(payload->'site',     '{}'::jsonb);
begin
  if v_company is null or not is_admin() then
    raise exception 'Keine gültige Admin-Anmeldung' using errcode = '42501';
  end if;

  -- 1) Kunde: bestehenden wiederverwenden oder neu anlegen
  if v_customer is null then
    insert into customers (company_id, sevdesk_contact_id, customer_number, name,
                           surename, familyname, is_company, email, phone, street, zip, city)
    values (v_company,
            nullif(c->>'sevdesk_contact_id',''), nullif(c->>'customer_number',''), c->>'name',
            nullif(c->>'surename',''), nullif(c->>'familyname',''), coalesce((c->>'is_company')::boolean, false),
            nullif(c->>'email',''), nullif(c->>'phone',''), nullif(c->>'street',''),
            nullif(c->>'zip',''), nullif(c->>'city',''))
    returning id into v_customer;
  end if;

  -- 2) Pipeline-Karte in Stage „Anfrage"
  insert into pipeline_cards (company_id, stage, customer_name, place, description, open_points, customer_id)
  values (v_company, 'Anfrage', k->>'customer_name', nullif(k->>'place',''),
          nullif(k->>'description',''), nullif(k->>'open_points',''), v_customer)
  returning id into v_card;

  -- 3) Anfrage (Inbox), verknüpft mit Kunde + Karte
  insert into inquiries (company_id, source, raw_text, parsed_json, customer_name, customer_phone,
                         customer_email, street, zip, city, description, notes, notes_log,
                         priority, customer_id, pipeline_card_id, status)
  values (v_company, i->>'source', i->>'raw_text', i->'parsed_json',
          nullif(i->>'customer_name',''), nullif(i->>'customer_phone',''), nullif(i->>'customer_email',''),
          nullif(i->>'street',''), nullif(i->>'zip',''), nullif(i->>'city',''),
          nullif(i->>'description',''), nullif(i->>'notes',''),
          jsonb_build_array(jsonb_build_object('at', now(), 'kind', 'system',
                            'text', 'Anfrage angelegt · Quelle ' || coalesce(i->>'source',''))),
          'normal', v_customer, v_card, 'in_arbeit')
  returning id into v_inquiry;

  -- 4) Baustelle mit aufgegliederter Adresse + Kontakt, verknüpft mit Kunde
  insert into sites (company_id, name, customer_name, street, zip, city, customer_phone,
                     customer_email, customer_id, sevdesk_contact_id, notes, starred)
  values (v_company, coalesce(nullif(s->>'name',''), k->>'customer_name'), nullif(s->>'customer_name',''),
          nullif(s->>'street',''), nullif(s->>'zip',''), nullif(s->>'city',''),
          nullif(s->>'customer_phone',''), nullif(s->>'customer_email',''), v_customer,
          nullif(s->>'sevdesk_contact_id',''), nullif(s->>'notes',''), false)
  returning id into v_site;

  -- Karte mit Baustelle verknüpfen
  update pipeline_cards set site_id = v_site where id = v_card;

  return jsonb_build_object('customer_id', v_customer, 'card_id', v_card,
                            'inquiry_id', v_inquiry, 'site_id', v_site);
end;
$$;

-- Nur angemeldete Nutzer dürfen die Funktion aufrufen (RLS regelt den Rest).
revoke all on function public.create_inquiry_bundle(jsonb) from public, anon;
grant execute on function public.create_inquiry_bundle(jsonb) to authenticated;
