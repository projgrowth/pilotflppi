import type { CountyRequirements } from "./types";

export const DEFAULT_REQUIREMENTS: CountyRequirements = {
  key: "default",
  label: "Default",
  hvhz: false,
  cccl: false,
  productApprovalFormat: "FL#",
  resubmissionDays: 14,
  amendments: [],
  supplementalSections: ["wind_mitigation", "energy_compliance"],
  buildingDepartment: {
    name: "Building Department",
    officialTitle: "Building Official",
    address: "",
  },
  designWindSpeed: "Per ASCE 7-22 Fig. 26.5-1",
  submissionNotes: [],
  thresholdBuildingAmount: 4_000_000,
  energyCodePath: "either",
  windBorneDebrisRegion: false,
  floodZoneRequired: false,
};

// Helper to reduce repetition for standard inland counties
function inland(key: string, label: string, windSpeed: string, dept: { name: string; address: string }): Partial<CountyRequirements> {
  return {
    key, label,
    designWindSpeed: windSpeed,
    supplementalSections: ["wind_mitigation", "product_approval_table", "energy_compliance"],
    buildingDepartment: { name: dept.name, officialTitle: "Building Official", address: dept.address },
  };
}

// Helper for coastal counties (non-HVHZ)
function coastal(key: string, label: string, windSpeed: string, dept: { name: string; address: string }, extra?: Partial<CountyRequirements>): Partial<CountyRequirements> {
  return {
    key, label, cccl: true,
    designWindSpeed: windSpeed,
    windBorneDebrisRegion: true,
    floodZoneRequired: true,
    supplementalSections: ["wind_mitigation", "product_approval_table", "flood_zone", "energy_compliance"],
    buildingDepartment: { name: dept.name, officialTitle: "Building Official", address: dept.address },
    ...extra,
  };
}

export const COUNTY_REGISTRY: Record<string, Partial<CountyRequirements>> = {
  // ─── SOUTHEAST ──────────────────────────────────────────────
  "miami-dade": {
    key: "miami-dade",
    label: "Miami-Dade",
    hvhz: true,
    cccl: true,
    productApprovalFormat: "NOA",
    windBorneDebrisRegion: true,
    floodZoneRequired: true,
    amendments: [
      { ref: "Miami-Dade Sec. 8A", description: "Local amendments to FBC for HVHZ construction" },
      { ref: "FBC 1626 (HVHZ)", description: "High Velocity Hurricane Zone requirements" },
      { ref: "FBC 1523 (HVHZ)", description: "Enhanced roofing requirements for HVHZ" },
      { ref: "Miami-Dade TAS 201/202/203", description: "Test protocols for impact-resistant products" },
      { ref: "Miami-Dade Resolution R-918-10", description: "Private provider notification requirements" },
    ],
    supplementalSections: [
      "wind_mitigation_enhanced", "noa_table", "flood_zone",
      "threshold_building", "cccl_compliance", "energy_compliance",
    ],
    buildingDepartment: {
      name: "Miami-Dade County Regulatory & Economic Resources",
      officialTitle: "Building Official / Director",
      address: "11805 SW 26th Street, Miami, FL 33175",
    },
    designWindSpeed: "≥ 175 mph (Ultimate) per ASCE 7-22 / FBC 1620.2",
    submissionNotes: [
      "All glazed openings require Miami-Dade NOA for impact resistance",
      "Product approval via Miami-Dade Notice of Acceptance (NOA) required — FL# not accepted in HVHZ",
      "40-year recertification / milestone inspection per F.S. 553.899 may apply",
      "Private Provider Notice must be filed with Building Official per Sec. 8A",
    ],
    energyCodePath: "performance",
  },

  broward: {
    key: "broward",
    label: "Broward",
    hvhz: true,
    cccl: true,
    productApprovalFormat: "NOA",
    windBorneDebrisRegion: true,
    floodZoneRequired: true,
    amendments: [
      { ref: "Broward County Amendments to FBC Ch. 17", description: "Local structural amendments" },
      { ref: "FBC 1626 (HVHZ)", description: "High Velocity Hurricane Zone requirements" },
      { ref: "Broward County Ordinance 2023-XX", description: "Local building safety amendments" },
    ],
    supplementalSections: [
      "wind_mitigation_enhanced", "noa_table", "flood_zone",
      "threshold_building", "energy_compliance",
    ],
    buildingDepartment: {
      name: "Broward County Environmental Licensing & Building Permitting Division",
      officialTitle: "Chief Building Official",
      address: "1 N. University Drive, Suite 3500, Plantation, FL 33324",
    },
    designWindSpeed: "≥ 175 mph (Ultimate) per ASCE 7-22 / FBC 1620.2",
    submissionNotes: [
      "Products must have valid Miami-Dade NOA or Broward County Evaluation",
      "Broward County requires form references for all product submissions",
      "25-year milestone inspection per F.S. 553.899 may apply",
    ],
    energyCodePath: "performance",
  },

  "palm-beach": coastal("palm-beach", "Palm Beach", "150-160 mph (Ultimate) per ASCE 7-22", {
    name: "Palm Beach County Building Division",
    address: "2300 N. Jog Road, West Palm Beach, FL 33411",
  }, {
    amendments: [
      { ref: "Palm Beach County Amendment to FBC Ch. 16", description: "Enhanced wind-borne debris region requirements" },
    ],
    supplementalSections: ["wind_mitigation", "product_approval_table", "flood_zone", "threshold_building", "energy_compliance"],
    submissionNotes: [
      "Wind-borne debris region — impact protection required per FBC 1609.1.4",
      "Florida Product Approval (FL#) accepted",
    ],
  }),

  martin: coastal("martin", "Martin", "150-160 mph (Ultimate) per ASCE 7-22", {
    name: "Martin County Building Department",
    address: "2401 SE Monterey Road, Stuart, FL 34996",
  }),

  "st-lucie": coastal("st-lucie", "St. Lucie", "150-160 mph (Ultimate) per ASCE 7-22", {
    name: "St. Lucie County Building Services",
    address: "2300 Virginia Avenue, Fort Pierce, FL 34982",
  }),

  "indian-river": coastal("indian-river", "Indian River", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Indian River County Building Division",
    address: "1801 27th Street, Vero Beach, FL 32960",
  }),

  okeechobee: inland("okeechobee", "Okeechobee", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Okeechobee County Building Department",
    address: "304 NW 2nd Street, Okeechobee, FL 34972",
  }),

  // ─── SOUTHWEST ──────────────────────────────────────────────
  lee: coastal("lee", "Lee", "150-160 mph (Ultimate) per ASCE 7-22", {
    name: "Lee County Community Development",
    address: "1500 Monroe Street, Fort Myers, FL 33901",
  }, {
    submissionNotes: ["Post-Hurricane Ian rebuilds may have additional requirements"],
  }),

  collier: coastal("collier", "Collier", "150-160 mph (Ultimate) per ASCE 7-22", {
    name: "Collier County Growth Management Department",
    address: "2800 N. Horseshoe Drive, Naples, FL 34104",
  }, {
    submissionNotes: ["Flood zone determination required — FEMA Coastal A & V zones prevalent"],
  }),

  charlotte: coastal("charlotte", "Charlotte", "150-160 mph (Ultimate) per ASCE 7-22", {
    name: "Charlotte County Building Construction Services",
    address: "18500 Murdock Circle, Port Charlotte, FL 33948",
  }, {
    submissionNotes: ["Post-Hurricane Ian rebuilds may have additional requirements"],
  }),

  sarasota: coastal("sarasota", "Sarasota", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Sarasota County Building Services",
    address: "1001 Sarasota Center Blvd, Sarasota, FL 34240",
  }),

  manatee: coastal("manatee", "Manatee", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Manatee County Building & Development Services",
    address: "1112 Manatee Avenue West, Bradenton, FL 34205",
  }),

  hendry: inland("hendry", "Hendry", "150-160 mph (Ultimate) per ASCE 7-22", {
    name: "Hendry County Building Department",
    address: "640 S. Main Street, LaBelle, FL 33935",
  }),

  glades: inland("glades", "Glades", "150-160 mph (Ultimate) per ASCE 7-22", {
    name: "Glades County Building Department",
    address: "500 Avenue J, Moore Haven, FL 33471",
  }),

  desoto: inland("desoto", "DeSoto", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "DeSoto County Building Department",
    address: "201 E. Oak Street, Arcadia, FL 34266",
  }),

  // ─── TAMPA BAY ──────────────────────────────────────────────
  hillsborough: inland("hillsborough", "Hillsborough", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Hillsborough County Building Services",
    address: "601 E. Kennedy Blvd, Tampa, FL 33602",
  }),

  pinellas: coastal("pinellas", "Pinellas", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Pinellas County Building Services",
    address: "440 Court Street, Clearwater, FL 33756",
  }, {
    submissionNotes: ["Flood zone determination required for all new construction"],
  }),

  pasco: coastal("pasco", "Pasco", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Pasco County Building Construction Services",
    address: "7530 Little Road, New Port Richey, FL 34654",
  }),

  polk: inland("polk", "Polk", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Polk County Building Division",
    address: "330 W. Church Street, Bartow, FL 33830",
  }),

  hernando: coastal("hernando", "Hernando", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Hernando County Building Division",
    address: "789 Providence Blvd, Brooksville, FL 34601",
  }),

  // ─── CENTRAL ──────────────────────────────────────────────
  orange: inland("orange", "Orange", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Orange County Building Safety Division",
    address: "201 S. Rosalind Ave, Orlando, FL 32801",
  }),

  osceola: inland("osceola", "Osceola", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Osceola County Building Department",
    address: "1 Courthouse Square, Kissimmee, FL 34741",
  }),

  seminole: inland("seminole", "Seminole", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Seminole County Building Division",
    address: "1101 E. First Street, Sanford, FL 32771",
  }),

  lake: inland("lake", "Lake", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Lake County Building Services",
    address: "315 W. Main Street, Tavares, FL 32778",
  }),

  sumter: inland("sumter", "Sumter", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Sumter County Building Department",
    address: "7375 Powell Road, Wildwood, FL 34785",
  }),

  brevard: coastal("brevard", "Brevard", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Brevard County Planning & Development",
    address: "2725 Judge Fran Jamieson Way, Viera, FL 32940",
  }),

  volusia: coastal("volusia", "Volusia", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Volusia County Building & Code Administration",
    address: "123 W. Indiana Avenue, DeLand, FL 32720",
  }),

  // ─── NORTHEAST ──────────────────────────────────────────────
  duval: coastal("duval", "Duval", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "City of Jacksonville Building Inspection Division",
    address: "214 N. Hogan Street, Jacksonville, FL 32202",
  }, {
    submissionNotes: ["Coastal construction control line requirements may apply for oceanfront parcels"],
  }),

  "st-johns": coastal("st-johns", "St. Johns", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "St. Johns County Building Services",
    address: "4040 Lewis Speedway, St. Augustine, FL 32084",
  }),

  clay: inland("clay", "Clay", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Clay County Building Department",
    address: "477 Houston Street, Green Cove Springs, FL 32043",
  }),

  nassau: coastal("nassau", "Nassau", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Nassau County Building Department",
    address: "96135 Nassau Place, Yulee, FL 32097",
  }),

  baker: inland("baker", "Baker", "110-120 mph (Ultimate) per ASCE 7-22", {
    name: "Baker County Building Department",
    address: "360 E. Shuey Avenue, Macclenny, FL 32063",
  }),

  flagler: coastal("flagler", "Flagler", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Flagler County Building Department",
    address: "1769 E. Moody Blvd, Bunnell, FL 32110",
  }),

  putnam: inland("putnam", "Putnam", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Putnam County Building Department",
    address: "2509 Crill Avenue, Palatka, FL 32177",
  }),

  // ─── NORTHWEST / PANHANDLE ──────────────────────────────────
  escambia: coastal("escambia", "Escambia", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Escambia County Building Inspections",
    address: "3363 West Park Place, Pensacola, FL 32505",
  }),

  "santa-rosa": coastal("santa-rosa", "Santa Rosa", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Santa Rosa County Building Inspections",
    address: "6051 Old Bagdad Highway, Milton, FL 32583",
  }),

  okaloosa: coastal("okaloosa", "Okaloosa", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Okaloosa County Building Department",
    address: "1250 Eglin Parkway NE, Fort Walton Beach, FL 32547",
  }),

  walton: coastal("walton", "Walton", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Walton County Building Department",
    address: "31 Coastal Centre Blvd, Santa Rosa Beach, FL 32459",
  }),

  holmes: inland("holmes", "Holmes", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Holmes County Building Department",
    address: "201 N. Oklahoma Street, Bonifay, FL 32425",
  }),

  washington: inland("washington", "Washington", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Washington County Building Department",
    address: "1331 South Blvd, Chipley, FL 32428",
  }),

  bay: coastal("bay", "Bay", "150-160 mph (Ultimate) per ASCE 7-22", {
    name: "Bay County Building Department",
    address: "840 W. 11th Street, Panama City, FL 32401",
  }, {
    submissionNotes: ["Post-Hurricane Michael rebuilds may have additional requirements"],
  }),

  jackson: inland("jackson", "Jackson", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Jackson County Building Department",
    address: "2864 Madison Street, Marianna, FL 32448",
  }),

  calhoun: inland("calhoun", "Calhoun", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Calhoun County Building Department",
    address: "20859 Central Avenue East, Blountstown, FL 32424",
  }),

  gulf: coastal("gulf", "Gulf", "150-160 mph (Ultimate) per ASCE 7-22", {
    name: "Gulf County Building Department",
    address: "1000 Cecil G. Costin Sr. Blvd, Port St. Joe, FL 32456",
  }, {
    submissionNotes: ["Post-Hurricane Michael rebuilds may have additional requirements"],
  }),

  liberty: inland("liberty", "Liberty", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Liberty County Building Department",
    address: "10818 NW SR 20, Bristol, FL 32321",
  }),

  gadsden: inland("gadsden", "Gadsden", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Gadsden County Building Department",
    address: "9 E. Jefferson Street, Quincy, FL 32351",
  }),

  leon: inland("leon", "Leon", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Leon County Building Inspection",
    address: "435 N. Macomb Street, Tallahassee, FL 32301",
  }),

  wakulla: coastal("wakulla", "Wakulla", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Wakulla County Building Department",
    address: "3093 Crawfordville Highway, Crawfordville, FL 32327",
  }),

  franklin: coastal("franklin", "Franklin", "140-150 mph (Ultimate) per ASCE 7-22", {
    name: "Franklin County Building Department",
    address: "34 Forbes Street, Apalachicola, FL 32320",
  }),

  jefferson: inland("jefferson", "Jefferson", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Jefferson County Building Department",
    address: "445 W. Palmer Mill Road, Monticello, FL 32344",
  }),

  madison: inland("madison", "Madison", "110-120 mph (Ultimate) per ASCE 7-22", {
    name: "Madison County Building Department",
    address: "229 SW Pinckney Street, Madison, FL 32340",
  }),

  taylor: coastal("taylor", "Taylor", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Taylor County Building Department",
    address: "201 E. Green Street, Perry, FL 32347",
  }),

  hamilton: inland("hamilton", "Hamilton", "110-120 mph (Ultimate) per ASCE 7-22", {
    name: "Hamilton County Building Department",
    address: "207 NE 1st Street, Jasper, FL 32052",
  }),

  suwannee: inland("suwannee", "Suwannee", "110-120 mph (Ultimate) per ASCE 7-22", {
    name: "Suwannee County Building Department",
    address: "224 Pine Avenue, Live Oak, FL 32064",
  }),

  lafayette: inland("lafayette", "Lafayette", "110-120 mph (Ultimate) per ASCE 7-22", {
    name: "Lafayette County Building Department",
    address: "120 W. Main Street, Mayo, FL 32066",
  }),

  dixie: coastal("dixie", "Dixie", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Dixie County Building Department",
    address: "214 NE Highway 351, Cross City, FL 32628",
  }),

  // ─── NORTH CENTRAL ──────────────────────────────────────────
  alachua: inland("alachua", "Alachua", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Alachua County Growth Management",
    address: "10 SW 2nd Avenue, Gainesville, FL 32601",
  }),

  columbia: inland("columbia", "Columbia", "110-120 mph (Ultimate) per ASCE 7-22", {
    name: "Columbia County Building Department",
    address: "135 NE Hernando Avenue, Lake City, FL 32055",
  }),

  bradford: inland("bradford", "Bradford", "110-120 mph (Ultimate) per ASCE 7-22", {
    name: "Bradford County Building Department",
    address: "945 N. Temple Avenue, Starke, FL 32091",
  }),

  union: inland("union", "Union", "110-120 mph (Ultimate) per ASCE 7-22", {
    name: "Union County Building Department",
    address: "15 NE 1st Street, Lake Butler, FL 32054",
  }),

  gilchrist: inland("gilchrist", "Gilchrist", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Gilchrist County Building Department",
    address: "209 SE 1st Street, Trenton, FL 32693",
  }),

  levy: coastal("levy", "Levy", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Levy County Building Department",
    address: "310 School Street, Bronson, FL 32621",
  }),

  marion: inland("marion", "Marion", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Marion County Building Safety",
    address: "2710 E. Silver Springs Blvd, Ocala, FL 34470",
  }),

  citrus: coastal("citrus", "Citrus", "120-130 mph (Ultimate) per ASCE 7-22", {
    name: "Citrus County Building Division",
    address: "3600 W. Sovereign Path, Lecanto, FL 34461",
  }),

  // ─── TREASURE COAST / KEYS / OTHER ─────────────────────────
  monroe: coastal("monroe", "Monroe", "160-175 mph (Ultimate) per ASCE 7-22", {
    name: "Monroe County Building Department",
    address: "2798 Overseas Highway, Marathon, FL 33050",
  }, {
    windBorneDebrisRegion: true,
    submissionNotes: [
      "Florida Keys — Rate of Growth Ordinance (ROGO) may restrict permits",
      "Velocity flood zones prevalent — V-zone construction requirements apply",
      "Wind speeds among highest in state — verify product approvals accordingly",
    ],
    supplementalSections: [
      "wind_mitigation", "product_approval_table", "flood_zone",
      "cccl_compliance", "threshold_building", "energy_compliance",
    ],
  }),

  hardee: inland("hardee", "Hardee", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Hardee County Building Department",
    address: "412 W. Orange Street, Wauchula, FL 33873",
  }),

  highlands: inland("highlands", "Highlands", "130-140 mph (Ultimate) per ASCE 7-22", {
    name: "Highlands County Building Department",
    address: "501 S. Commerce Avenue, Sebring, FL 33870",
  }),
};
