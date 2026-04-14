
-- Create ai_outputs table
CREATE TABLE public.ai_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  input_data jsonb,
  prediction text,
  confidence_score decimal(4,3),
  severity text CHECK (severity IN ('critical','major','minor','admin')),
  model_version text,
  correction_augmented boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ai_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ai_outputs" ON public.ai_outputs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert ai_outputs" ON public.ai_outputs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update ai_outputs" ON public.ai_outputs FOR UPDATE TO authenticated USING (true);

CREATE INDEX idx_ai_outputs_project_id ON public.ai_outputs(project_id);
CREATE INDEX idx_ai_outputs_severity ON public.ai_outputs(severity);

-- Create corrections table
CREATE TABLE public.corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id uuid REFERENCES public.ai_outputs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  original_value text,
  corrected_value text,
  correction_type text CHECK (correction_type IN ('override','edit','flag','dismiss')),
  fbc_section text,
  context_notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read corrections" ON public.corrections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own corrections" ON public.corrections FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can update own corrections" ON public.corrections FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE INDEX idx_corrections_output_id ON public.corrections(output_id);
CREATE INDEX idx_corrections_user_id ON public.corrections(user_id);

-- Create flag_embeddings table
CREATE TABLE public.flag_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_id uuid REFERENCES public.corrections(id) ON DELETE CASCADE,
  embedding text, -- stored as serialized vector text
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.flag_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read flag_embeddings" ON public.flag_embeddings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert flag_embeddings" ON public.flag_embeddings FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_flag_embeddings_correction_id ON public.flag_embeddings(correction_id);

-- Create review_flags table
CREATE TABLE public.review_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  sheet_ref text,
  detail_ref text,
  fbc_section text,
  description text,
  severity text CHECK (severity IN ('critical','major','minor','admin')),
  confidence text CHECK (confidence IN ('high','medium','low')),
  status text CHECK (status IN ('active','resolved','dismissed')) DEFAULT 'active',
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.review_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read review_flags" ON public.review_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert review_flags" ON public.review_flags FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update review_flags" ON public.review_flags FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete review_flags" ON public.review_flags FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_review_flags_project_id ON public.review_flags(project_id);
CREATE INDEX idx_review_flags_severity ON public.review_flags(severity);
CREATE INDEX idx_review_flags_confidence ON public.review_flags(confidence);
CREATE INDEX idx_review_flags_status ON public.review_flags(status);

-- Create deficiencies table
CREATE TABLE public.deficiencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fbc_section text NOT NULL,
  title text NOT NULL,
  discipline text CHECK (discipline IN ('architectural','structural','mechanical','electrical','plumbing','energy','accessibility','general')),
  severity text CHECK (severity IN ('critical','major','minor','admin')),
  description text,
  standard_comment_language text,
  is_florida_specific boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.deficiencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read deficiencies" ON public.deficiencies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert deficiencies" ON public.deficiencies FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update deficiencies" ON public.deficiencies FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete deficiencies" ON public.deficiencies FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_deficiencies_discipline ON public.deficiencies(discipline);
CREATE INDEX idx_deficiencies_severity ON public.deficiencies(severity);

-- Seed 25 Florida-specific deficiencies
INSERT INTO public.deficiencies (fbc_section, title, discipline, severity, description, standard_comment_language, is_florida_specific) VALUES
('R802.11', 'Hurricane Strap Connections', 'structural', 'critical', 'Roof-to-wall connections in 130+ mph wind zones require specified hurricane strap type, spacing, and FL Product Approval number.', 'Sheet [X], Detail [X]: Roof-to-wall connections do not specify hurricane strap type, spacing, or FL Product Approval number. Per FBC R802.11 and ASCE 7-22, provide a connector schedule specifying strap model, FL Product Approval #, spacing, and nail pattern for design wind speed of [X] mph.', true),
('R301.2.1.2', 'Wind-Borne Debris Protection', 'architectural', 'critical', 'All glazed openings in wind-borne debris regions must have FL Product Approved impact protection or shutters.', 'Sheet [X]: Glazed opening(s) shown without impact-resistant glazing or approved shutter system. Per FBC R301.2.1.2, all openings in Wind-Borne Debris Regions require FL Product Approved impact protection. Provide product specifications and FL Product Approval numbers for all opening protection.', true),
('1714.5', 'Florida Product Approval Missing', 'general', 'major', 'Products installed in the building envelope require Florida Product Approval numbers on the construction documents.', 'Sheet [X]: Product shown at [location] does not include Florida Product Approval number. Per FBC 1714.5, all products requiring approval must list the FL Product Approval # on the drawings. Revise to include approval numbers for all envelope components.', true),
('R322', 'Flood Zone BFE Compliance', 'structural', 'critical', 'Construction in flood zones must demonstrate Base Flood Elevation compliance and applicable flood-resistant construction methods.', 'Sheet [X]: Project is located in Flood Zone [X] with BFE of [X] ft NAVD88. Plans do not demonstrate finish floor elevation at or above required BFE + freeboard. Per FBC R322, provide flood zone certification, BFE documentation, and confirm lowest floor elevation meets or exceeds [X] ft NAVD88.', true),
('R401.2', 'Energy Code — Form 405 Not Submitted', 'energy', 'major', 'Florida residential projects require Form 405 energy compliance report demonstrating performance path compliance.', 'Energy compliance documentation not included with submittal. Per FBC R401.2, a Florida-specific Form 405 energy compliance report must be submitted and approved prior to permit issuance. Submit a completed Form 405 generated by approved software (EnergyGauge, REScheck-Web FL edition).', true),
('R310', 'Egress Window Dimensions', 'architectural', 'critical', 'Sleeping rooms must have egress windows meeting minimum net clear opening, height, width, and sill height requirements.', 'Sheet [X], Room [X]: Egress window shown does not meet minimum requirements. Per FBC R310.2, required minimums are: net clear opening 5.7 sf (grade floor 5.0 sf), min height 24 in, min width 20 in, max sill height 44 in from floor. Revise window schedule to comply.', false),
('R314', 'Smoke Detector Placement', 'general', 'critical', 'Smoke alarms required in each sleeping room, outside sleeping areas, and on each story including basement.', 'Sheet [X]: Smoke alarm locations not shown or incomplete. Per FBC R314, smoke alarms are required in: each sleeping room, outside each sleeping area, and on each story. Revise electrical plans to show all required smoke alarm locations with interconnect wiring.', false),
('R302.5', 'Garage Separation', 'architectural', 'critical', 'Garage must be separated from dwelling and attic space with specified fire-rated assemblies and self-closing, self-latching doors.', 'Sheet [X]: Garage-to-dwelling separation not clearly detailed. Per FBC R302.5, the garage must be separated from the residence with not less than 1/2-inch gypsum board on the garage side. Door between garage and dwelling must be solid wood, solid steel, or 20-minute fire-rated, self-closing and self-latching. Provide separation details.', false),
('R311', 'Stair/Handrail Dimensions', 'architectural', 'major', 'Stairways must meet minimum width, riser height, tread depth, and handrail requirements.', 'Sheet [X]: Stair details shown do not comply with FBC R311. Required: min width 36 in, max riser 7-3/4 in, min tread 10 in, min headroom 6 ft 8 in. Handrails per R311.7.8: between 34-38 in above nosing, required on at least one side for 4+ risers. Revise stair details to comply.', false),
('M1401.3', 'HVAC — Manual J Not Provided', 'mechanical', 'major', 'HVAC equipment sizing must be supported by Manual J heat load calculation for Florida climate zones.', 'Sheet [X]: HVAC equipment shown without supporting load calculations. Per FBC M1401.3, heating and cooling equipment must be sized per ACCA Manual J. Submit a Florida-specific Manual J load calculation report for the proposed HVAC system. Equipment capacity must match calculated loads within ACCA tolerance.', true),
('E230.66', 'Electrical Panel Clearance', 'electrical', 'major', 'Electrical service panels require minimum 36-inch clearance in front and specific headroom/side clearances.', 'Sheet [X]: Panel location shown does not provide required working clearances. Per FBC E230.66 (NEC 110.26), electrical panels require: minimum 36 in depth in front of panel, 30 in width, 6 ft 6 in headroom. Revise panel location or room dimensions to provide required clearances.', false),
('E230.79', 'Service Entrance Capacity', 'electrical', 'major', 'Service entrance conductor sizing must be adequate for the calculated load per NEC Article 220.', 'Sheet [X]: Service entrance ampacity not specified or appears undersized for the calculated load. Per FBC E230.79 (NEC 230.79), service conductors must have adequate ampacity for the load served. Provide load calculation per NEC Article 220 and confirm service entrance ampacity meets or exceeds calculated demand.', false),
('P2903', 'Plumbing Fixture Unit Count', 'plumbing', 'major', 'Water supply and drain sizing must be based on fixture unit count per FBC plumbing chapters.', 'Sheet [X]: Plumbing fixture schedule provided but water distribution and drain/waste/vent sizing not shown or inadequately sized for fixture unit count. Per FBC P2903, size all water supply pipes based on fixture units. Provide a plumbing riser diagram showing pipe sizes, fixture units, and pressure calculations.', false),
('107.3.4', 'Structural Calculations — Not Signed/Sealed', 'structural', 'major', 'Structural calculations must be signed and sealed by a Florida-licensed engineer of record.', 'Structural calculations submitted are not signed and sealed by a Florida-licensed structural or civil engineer. Per FBC 107.3.4, all structural calculations must bear the signature and seal of the engineer of record licensed in the State of Florida. Resubmit with properly sealed calculations.', true),
('1803', 'Geotechnical Report Required', 'structural', 'major', 'Projects requiring soil bearing capacity verification must include a geotechnical investigation report.', 'Sheet [X]: Foundation design references soil bearing capacity of [X] psf without supporting geotechnical investigation. Per FBC 1803, a geotechnical report prepared by a licensed geotechnical engineer is required. Submit geotechnical report confirming soil bearing values used in foundation design.', false),
('11B-206', 'Accessibility — Path of Travel', 'accessibility', 'critical', 'Projects triggering ADA path of travel requirements must show accessible route from site arrival to all primary function areas.', 'Sheet [X]: Project scope triggers accessible path of travel requirements. Per FBC Chapter 11B and ADA Standards, an accessible route must be provided from site arrival points to all primary function areas. Revise site and floor plans to show compliant accessible route with slopes, curb ramps, and accessible parking per 11B-208.', true),
('R302.3', 'Fire Separation — Party Walls', 'architectural', 'critical', 'Dwelling unit separation walls in townhouses or two-family dwellings require minimum 1-hour fire-resistance rating.', 'Sheet [X]: Party wall between units not detailed to meet fire separation requirements. Per FBC R302.3, dwelling unit separation in two-family dwellings and townhouses requires a minimum 1-hour fire-resistance-rated wall assembly tested per ASTM E119. Provide UL-listed or tested assembly details for all party walls.', false),
('R807', 'Attic Access', 'architectural', 'minor', 'Attics with 30+ inches of vertical height require an access opening of minimum 22x30 inches.', 'Sheet [X]: Attic access opening not shown or undersized. Per FBC R807.1, attics with a clear height of 30 inches or greater require an access opening of not less than 22 by 30 inches. Show attic access location on floor plan with minimum rough opening dimensions of 22 x 30 in.', false),
('G2417', 'Gas Line Pressure Test Documentation', 'mechanical', 'major', 'Gas piping must be tested and approved before concealment. Test documentation must be noted on plans.', 'Sheet [X]: Mechanical plans show gas piping without specifying required pressure test procedure. Per FBC G2417, gas piping must be tested at not less than 1.5 times the maximum operating pressure (minimum 3 psig for pressures of 14 in w.c. or less). Note test requirements and inspection hold point on mechanical drawings.', false),
('R326', 'Pool/Spa Barrier Requirements', 'architectural', 'critical', 'Swimming pools and spas require approved barrier/fence system meeting height, gate, and opening requirements.', 'Sheet [X]: Pool/spa shown without compliant barrier system. Per FBC R326 and Florida Statutes 515, pools require an enclosure barrier with: minimum 4 ft height, maximum 4-inch vertical opening clearance, self-closing/self-latching gates that open away from pool, and no climbable elements. Provide barrier layout and detail on site plan.', true),
('R905', 'Roof Underlayment Specification', 'architectural', 'major', 'Florida roof assemblies require FL Product Approved underlayment systems appropriate to the wind zone.', 'Sheet [X]: Roof assembly shown without specifying underlayment system. Per FBC R905 and Florida requirements, roof underlayment must be FL Product Approved for the applicable wind zone. Provide underlayment specification including FL Product Approval number, installation method, and fastening schedule per manufacturer requirements.', true),
('R403.1.6', 'Anchor Bolt Spacing — Sill Plate', 'structural', 'critical', 'Sill plate anchor bolts must meet spacing and embedment requirements for the design wind speed.', 'Sheet [X]: Foundation plan shows sill plate anchor bolts without confirming spacing meets uplift requirements. Per FBC R403.1.6, anchor bolts must be spaced per the calculated uplift demand for the design wind speed of [X] mph. Provide anchor bolt schedule specifying bolt diameter, embedment, spacing, and connection to foundation per engineered design.', true),
('R402', 'Thermal Envelope — Insulation R-Values', 'energy', 'major', 'Building thermal envelope must meet minimum R-value requirements for Florida climate zone.', 'Sheet [X]: Insulation specifications do not meet Florida Energy Code requirements for Climate Zone [X]. Per FBC R402, minimum requirements are: ceiling R-38, wood frame walls R-13, floor R-13. Revise insulation schedule to comply with FBC Table R402.1.2 for the applicable climate zone and confirm compliance via Form 405.', true),
('107.1', 'Sealed Drawings Required', 'general', 'major', 'Construction documents for permitted work must be signed and sealed by the appropriate licensed design professional.', 'Cover sheet: Construction documents are not signed and sealed by a Florida-licensed design professional. Per FBC 107.1, plans for [building type/scope] must bear the signature and seal of a Florida-licensed [architect/engineer]. Resubmit all sheets with proper professional seal and signature. Verify scope triggers threshold requirements per FBC 471/481.', true);
