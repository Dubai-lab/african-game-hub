-- Token value: 1,000 tokens = 0.50 USD, so one token = 0.0005 USD.
-- Each country's token_to_currency_rate (local currency per token) is that value converted at the
-- USD exchange rate below. Real money is still off everywhere; until a country is switched on
-- these rates are only used to show players roughly what tokens are worth.
--
-- Exchange rates: open.er-api.com, 7 October 2026. They go stale. Before real money is enabled
-- in any country the rates must be refreshed on a schedule, and every payment already stores
-- the rate it used (payments.rate_used).

alter table public.platform_settings
  add column token_value_usd numeric(12, 8) not null default 0.0005 check (token_value_usd > 0);

alter table public.countries
  add column usd_exchange_rate numeric(20, 8) check (usd_exchange_rate > 0),
  add column rate_updated_at timestamptz;

update public.countries c
   set usd_exchange_rate = fx.per_usd,
       token_to_currency_rate = round(fx.per_usd * s.token_value_usd, 8),
       rate_updated_at = '2026-10-07T00:02:32Z'
  from public.platform_settings s,
       (values
         ('DZD', 134.395631), ('AOA', 926.61105), ('XOF', 582.979097), ('BWP', 14.246163),
         ('BIF', 3000.839101), ('CVE', 97.997567), ('XAF', 582.979097), ('KMF', 437.234323),
         ('CDF', 2310.952504), ('DJF', 177.721), ('EGP', 52.305619), ('ERN', 15),
         ('SZL', 16.53412), ('ETB', 161.306149), ('GMD', 74.41109), ('GHS', 11.622419),
         ('GNF', 8795.384184), ('KES', 129.556657), ('LSL', 16.53412), ('LRD', 170.519968),
         ('LYD', 6.42947), ('MGA', 4448.633171), ('MWK', 1745.634545), ('MRU', 40.111108),
         ('MUR', 47.507349), ('MAD', 9.963782), ('MZN', 63.826558), ('NAD', 16.53412),
         ('NGN', 1328.1192), ('RWF', 1478.41889), ('STN', 21.774275), ('SCR', 14.593718),
         ('SLE', 24.654462), ('SOS', 571.702839), ('ZAR', 16.534158), ('SSP', 5651.660944),
         ('SDG', 449.44214), ('TZS', 2645.675989), ('TND', 2.975208), ('UGX', 3920.309756),
         ('ZMW', 19.706552), ('ZWG', 26.7583)
       ) as fx (currency_code, per_usd)
 where c.currency_code = fx.currency_code;
