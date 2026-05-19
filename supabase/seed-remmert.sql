-- UPDATE Baustelle Remmert mit allen Daten aus sevDesk (Stand 2026-05-12).
-- Source: sevDesk Contact 126576940, Orders AN-1226 + AN-1252.
--
-- Vorausgesetzt: migration 20260512120000_site_customer_fields.sql ist drin.

update sites set
  street               = 'Grüner Weg 6',
  zip                  = '26899',
  city                 = 'Rhede (Ems)',
  customer_name        = 'Andrea Remmert',
  customer_phone       = '015255993998',
  customer_email       = 'a.remmert80@gmail.com',
  sevdesk_contact_id   = '126576940',
  sevdesk_order_number = 'AN-1226',
  estimate_net_eur     = 7468.71,
  notes                = E'sevDesk-Kundennummer: 1236\n' ||
                          E'Hauptauftrag AN-1226 (03.03.2026, 7.468,71 € netto, Status offen)\n' ||
                          E'Nachtrag/Angebot AN-1252 (11.05.2026, 4.350 € netto, Status Entwurf)\n' ||
                          E'Rechnungen: RE-1248 (31.03., 1.890 € bezahlt) · RE-1254 (24.04., 2.061,34 € offen)\n' ||
                          E'\n' ||
                          E'Leistungen AN-1226 (Auszug):\n' ||
                          E'- Bagger-/Radladerarbeiten 8 Std · 60 €\n' ||
                          E'- RC-Schotter 22 m³ · 27,50 €/m³\n' ||
                          E'- Pflasterarbeiten 38 Std · 60 €\n' ||
                          E'- H-Steine Haco VI Pflaster 10cm grau 113,31 m² · 15,10 €/m²'
where id = 'ceaac537-7d6d-474d-995c-bb5a851b8c3b';
