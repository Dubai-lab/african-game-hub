-- Reference data. Real money stays off everywhere until a country is licensed and switched on.

insert into public.platform_settings (id) values (true);

-- The first admin. Takes effect when this address signs up and confirms its email.
insert into private.admin_emails (email) values ('eg8217178@gmail.com');

insert into public.countries (country_code, name, currency_code, currency_minor_units, default_language) values
  ('DZ', 'Algeria', 'DZD', 2, 'ar'),
  ('AO', 'Angola', 'AOA', 2, 'pt'),
  ('BJ', 'Benin', 'XOF', 0, 'fr'),
  ('BW', 'Botswana', 'BWP', 2, 'en'),
  ('BF', 'Burkina Faso', 'XOF', 0, 'fr'),
  ('BI', 'Burundi', 'BIF', 0, 'fr'),
  ('CV', 'Cabo Verde', 'CVE', 2, 'pt'),
  ('CM', 'Cameroon', 'XAF', 0, 'fr'),
  ('CF', 'Central African Republic', 'XAF', 0, 'fr'),
  ('TD', 'Chad', 'XAF', 0, 'fr'),
  ('KM', 'Comoros', 'KMF', 0, 'fr'),
  ('CG', 'Congo', 'XAF', 0, 'fr'),
  ('CD', 'DR Congo', 'CDF', 2, 'fr'),
  ('CI', 'Côte d''Ivoire', 'XOF', 0, 'fr'),
  ('DJ', 'Djibouti', 'DJF', 0, 'fr'),
  ('EG', 'Egypt', 'EGP', 2, 'ar'),
  ('GQ', 'Equatorial Guinea', 'XAF', 0, 'fr'),
  ('ER', 'Eritrea', 'ERN', 2, 'en'),
  ('SZ', 'Eswatini', 'SZL', 2, 'en'),
  ('ET', 'Ethiopia', 'ETB', 2, 'en'),
  ('GA', 'Gabon', 'XAF', 0, 'fr'),
  ('GM', 'Gambia', 'GMD', 2, 'en'),
  ('GH', 'Ghana', 'GHS', 2, 'en'),
  ('GN', 'Guinea', 'GNF', 0, 'fr'),
  ('GW', 'Guinea-Bissau', 'XOF', 0, 'pt'),
  ('KE', 'Kenya', 'KES', 2, 'en'),
  ('LS', 'Lesotho', 'LSL', 2, 'en'),
  ('LR', 'Liberia', 'LRD', 2, 'en'),
  ('LY', 'Libya', 'LYD', 3, 'ar'),
  ('MG', 'Madagascar', 'MGA', 2, 'fr'),
  ('MW', 'Malawi', 'MWK', 2, 'en'),
  ('ML', 'Mali', 'XOF', 0, 'fr'),
  ('MR', 'Mauritania', 'MRU', 2, 'ar'),
  ('MU', 'Mauritius', 'MUR', 2, 'en'),
  ('MA', 'Morocco', 'MAD', 2, 'ar'),
  ('MZ', 'Mozambique', 'MZN', 2, 'pt'),
  ('NA', 'Namibia', 'NAD', 2, 'en'),
  ('NE', 'Niger', 'XOF', 0, 'fr'),
  ('NG', 'Nigeria', 'NGN', 2, 'en'),
  ('RW', 'Rwanda', 'RWF', 0, 'en'),
  ('ST', 'São Tomé and Príncipe', 'STN', 2, 'pt'),
  ('SN', 'Senegal', 'XOF', 0, 'fr'),
  ('SC', 'Seychelles', 'SCR', 2, 'en'),
  ('SL', 'Sierra Leone', 'SLE', 2, 'en'),
  ('SO', 'Somalia', 'SOS', 2, 'en'),
  ('ZA', 'South Africa', 'ZAR', 2, 'en'),
  ('SS', 'South Sudan', 'SSP', 2, 'en'),
  ('SD', 'Sudan', 'SDG', 2, 'ar'),
  ('TZ', 'Tanzania', 'TZS', 2, 'sw'),
  ('TG', 'Togo', 'XOF', 0, 'fr'),
  ('TN', 'Tunisia', 'TND', 3, 'ar'),
  ('UG', 'Uganda', 'UGX', 0, 'en'),
  ('ZM', 'Zambia', 'ZMW', 2, 'en'),
  ('ZW', 'Zimbabwe', 'ZWG', 2, 'en');

insert into public.game_types (id, name, status, sort_order, min_players, max_players, stake_levels, options_schema) values
  (
    'chess', 'Chess', 'live', 10, 2, 2,
    array[0, 50, 100, 250, 500, 1000]::bigint[],
    '{
      "time_controls": [
        {"id": "1+0", "base_ms": 60000, "increment_ms": 0},
        {"id": "3+0", "base_ms": 180000, "increment_ms": 0},
        {"id": "3+2", "base_ms": 180000, "increment_ms": 2000},
        {"id": "5+0", "base_ms": 300000, "increment_ms": 0},
        {"id": "5+3", "base_ms": 300000, "increment_ms": 3000},
        {"id": "10+0", "base_ms": 600000, "increment_ms": 0},
        {"id": "10+5", "base_ms": 600000, "increment_ms": 5000}
      ]
    }'::jsonb
  ),
  ('ludo', 'Ludo', 'coming_soon', 20, 2, 4, '{}', '{}'::jsonb),
  ('draughts', 'Draughts', 'coming_soon', 30, 2, 2, '{}', '{}'::jsonb),
  ('pool', 'Pool', 'coming_soon', 40, 2, 2, '{}', '{}'::jsonb),
  ('penalty', 'Penalty Shootout', 'coming_soon', 50, 2, 2, '{}', '{}'::jsonb);

-- Accounts created before these migrations ran get the same setup as new ones.
do $$
declare
  u record;
begin
  for u in select id, raw_user_meta_data, email, email_confirmed_at from auth.users loop
    perform private.provision_user(u.id, u.raw_user_meta_data, u.email, u.email_confirmed_at);
  end loop;
end;
$$;
