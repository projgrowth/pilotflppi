
ALTER TABLE public.discipline_negative_space
  ADD COLUMN IF NOT EXISTS sheet_hints jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill hints. Each row gets {disciplines:[...], keywords:[...]}.
-- Disciplines match canonical sheet_coverage.discipline labels.
UPDATE public.discipline_negative_space SET sheet_hints = v.hints
FROM (VALUES
  ('window_door_fl',           '{"disciplines":["Architectural"],"keywords":["window","door","schedule","elevation"]}'::jsonb),
  ('roof_assembly_fl',         '{"disciplines":["Architectural","Structural"],"keywords":["roof","plan","detail"]}'::jsonb),
  ('soffit_fl',                '{"disciplines":["Architectural"],"keywords":["soffit","fascia","eave","detail"]}'::jsonb),
  ('wind_design_params',       '{"disciplines":["Structural","Architectural"],"keywords":["cover","general notes","wind","design criteria"]}'::jsonb),
  ('climatic_geographic_table','{"disciplines":["Architectural","Structural"],"keywords":["cover","general notes","design criteria"]}'::jsonb),
  ('flood_design',             '{"disciplines":["Architectural","Civil","Structural"],"keywords":["flood","elevation","site"]}'::jsonb),
  ('garage_separation',        '{"disciplines":["Architectural"],"keywords":["floor plan","wall section","garage","detail"]}'::jsonb),
  ('townhouse_separation',     '{"disciplines":["Architectural","Structural"],"keywords":["wall section","party wall","detail"]}'::jsonb),
  ('eero',                     '{"disciplines":["Architectural"],"keywords":["floor plan","bedroom","window schedule"]}'::jsonb),
  ('stair_geometry',           '{"disciplines":["Architectural"],"keywords":["stair","section","detail"]}'::jsonb),
  ('guards',                   '{"disciplines":["Architectural"],"keywords":["stair","balcony","guard","detail"]}'::jsonb),
  ('smoke_alarms',             '{"disciplines":["Architectural","MEP"],"keywords":["floor plan","electrical","reflected"]}'::jsonb),
  ('co_alarms',                '{"disciplines":["Architectural","MEP"],"keywords":["floor plan","electrical","reflected"]}'::jsonb),
  ('wall_bracing',             '{"disciplines":["Structural"],"keywords":["braced wall","framing","plan","shear"]}'::jsonb),
  ('wall_anchorage',           '{"disciplines":["Structural"],"keywords":["anchor","holdown","detail","schedule"]}'::jsonb),
  ('wrb',                      '{"disciplines":["Architectural"],"keywords":["wall section","detail","exterior","flashing"]}'::jsonb),
  ('attic_ventilation',        '{"disciplines":["Architectural"],"keywords":["roof","attic","ventilation","detail"]}'::jsonb),
  ('roof_assembly_uplift',     '{"disciplines":["Structural"],"keywords":["roof framing","detail","uplift","schedule"]}'::jsonb),
  ('egress_door',              '{"disciplines":["Architectural"],"keywords":["floor plan","door schedule"]}'::jsonb),
  ('foundation',               '{"disciplines":["Structural"],"keywords":["foundation","footing","plan","detail"]}'::jsonb),
  ('crawl_space',              '{"disciplines":["Structural","Architectural"],"keywords":["foundation","crawl","plan"]}'::jsonb),
  ('energy_path',              '{"disciplines":["Architectural"],"keywords":["energy","cover","rescheck","form","compliance"]}'::jsonb),
  ('envelope_insulation',      '{"disciplines":["Architectural"],"keywords":["wall section","insulation","detail","energy"]}'::jsonb),
  ('fenestration_u_shgc',      '{"disciplines":["Architectural"],"keywords":["window schedule","energy","rescheck"]}'::jsonb),
  ('duct_sealing',             '{"disciplines":["MEP"],"keywords":["mechanical","duct","plan","notes"]}'::jsonb),
  ('blower_door',              '{"disciplines":["Architectural","MEP"],"keywords":["energy","notes","testing"]}'::jsonb),
  ('mech_efficiency',          '{"disciplines":["MEP"],"keywords":["mechanical","schedule","equipment"]}'::jsonb),
  ('lighting',                 '{"disciplines":["MEP","Architectural"],"keywords":["electrical","lighting","reflected","schedule"]}'::jsonb),
  ('panel_schedule',           '{"disciplines":["MEP"],"keywords":["panel","schedule","electrical","riser"]}'::jsonb),
  ('service_size',             '{"disciplines":["MEP"],"keywords":["riser","load","calculation","electrical"]}'::jsonb),
  ('smoke_co_power',           '{"disciplines":["MEP","Architectural"],"keywords":["electrical","reflected","circuit","notes"]}'::jsonb),
  ('exhaust_air',              '{"disciplines":["MEP"],"keywords":["mechanical","exhaust","plan"]}'::jsonb),
  ('combustion_air',           '{"disciplines":["MEP"],"keywords":["mechanical","gas","combustion","detail"]}'::jsonb),
  ('plumbing_fixtures',        '{"disciplines":["MEP"],"keywords":["plumbing","plan","fixture","schedule"]}'::jsonb),
  ('water_heater',             '{"disciplines":["MEP"],"keywords":["plumbing","water heater","detail","riser"]}'::jsonb),
  ('backflow',                 '{"disciplines":["MEP"],"keywords":["plumbing","backflow","irrigation","detail"]}'::jsonb),
  ('dryer_exhaust_length',     '{"disciplines":["MEP"],"keywords":["mechanical","dryer","exhaust"]}'::jsonb),
  ('floor_joist_schedule',     '{"disciplines":["Structural"],"keywords":["floor framing","joist","schedule","plan"]}'::jsonb),
  ('header_schedule',          '{"disciplines":["Structural"],"keywords":["header","schedule","framing"]}'::jsonb),
  ('rafter_truss',             '{"disciplines":["Structural"],"keywords":["roof framing","truss","rafter","plan"]}'::jsonb),
  ('hvhz_uplift',              '{"disciplines":["Structural"],"keywords":["uplift","connector","detail","hvhz"]}'::jsonb),
  ('foundation_anchor',        '{"disciplines":["Structural"],"keywords":["anchor bolt","foundation","detail"]}'::jsonb),
  ('slab_reinforcement',       '{"disciplines":["Structural"],"keywords":["slab","foundation","plan","detail"]}'::jsonb)
) AS v(item_key, hints)
WHERE public.discipline_negative_space.item_key = v.item_key
  AND public.discipline_negative_space.use_type = 'residential';
