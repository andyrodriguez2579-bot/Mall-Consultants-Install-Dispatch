-- =============================================================================
-- 0015  Service catalogue
-- =============================================================================
-- Transcribed from the Mall Consultants zone pricing workbook. Every price is
-- the CUSTOMER labor price per task; the contractor's share is derived from it
-- by the generated columns added in 0014.
--
-- Two groups:
--   * the per-task service schedule (stop charges, installs, PM, repairs,
--     conversions, DM install/removal/swap-out, training, laundry)
--   * the per-program zone install prices (7-Eleven, Subway, SSDC A-Program …)
--
-- The mileage and reimbursable columns on the workbook are not services and are
-- handled separately on the job itself, never split.

-- The reference record, exactly as specified:
--   Service code           SSDC-A-PROGRAM
--   Service name           SSDC A-Program Installation
--   Category               SSDC Installation
--   Customer labor price   $120.00
--   Contractor 45%         $54.00   (generated)
--   Mall Consultants 55%   $66.00   (generated)
--   Mileage                separate
--   Status                 active
insert into public.price_list_items
  (code, name, category, scope_description, customer_labor_price_cents,
   allows_quantity, allows_additional_labor, allows_mileage, sort_order, is_active)
values
  ('SSDC-A-PROGRAM', 'SSDC A-Program Installation', 'SSDC Installation',
   'Install the SSDC A-Program dispenser with standard scrape sprayer water connection. Fit all brackets, signage and stickers, fill spray bottles with the correct products, and train staff on dispenser and product use. Everything in the box must be installed.',
   12000, true, true, true, 1, true)
on conflict (code) do nothing;

-- Service catalogue, transcribed from the Mall Consultants zone pricing
-- workbook. Prices are the CUSTOMER labor price per task.
insert into public.price_list_items
  (code, name, category, scope_description, customer_labor_price_cents,
   allows_quantity, allows_additional_labor, allows_mileage, sort_order, is_active)
values
  ('STOP-TRUCK-STOP-CHARGE-NO', 'Truck Stop Charge ( no sink / no kit / job cannot be completed)', 'STOP CHARGE', 'Truck Stop Charge ( no sink / no kit / job cannot be completed)', 6790, true, true, true, 10, true),
  ('STOP-TRUCK-STOP-CHARGE-SURVEY', 'Truck Stop Charge (survey account)', 'STOP CHARGE', 'Truck Stop Charge (survey account)', 8050, true, true, true, 20, true),
  ('OER-REMOVE-EXISTING-EQUIPMENT-SIGNAGE', 'Remove all existing equipment & signage per location', 'OLD EQUIPMENT REMOVAL', 'Remove all existing equipment & signage per location', 2450, true, true, true, 30, true),
  ('INST-PROGRAM-STANDARD-SCRAP-SPRAYER', 'A-Program - (standard scrap sprayer water connection)', 'INSTALL EQUIPMENT', 'A-Program - (standard scrap sprayer water connection)', 12040, true, true, true, 40, true),
  ('INST-PROGRAM-BUILD-UP-FAUCET', 'A-Program - (need to build-up faucet water connection) add', 'INSTALL EQUIPMENT', 'A-Program - (need to build-up faucet water connection) add', 1750, true, true, true, 50, true),
  ('INST-PROGRAM-TEE-WATER-SUPPLY', 'A-Program - (need to tee to water supply  under sink) add', 'INSTALL EQUIPMENT', 'A-Program - (need to tee to water supply  under sink) add', 2450, true, true, true, 60, true),
  ('INST-MOPRITE-III', 'Moprite III', 'INSTALL EQUIPMENT', 'Moprite III', 8050, true, true, true, 70, true),
  ('INST-MOPRITE-II', 'Moprite II', 'INSTALL EQUIPMENT', 'Moprite II', 7630, true, true, true, 80, true),
  ('INST-SINK-RITE-SOLO', 'Sink-Rite Solo', 'INSTALL EQUIPMENT', 'Sink-Rite Solo', 7280, true, true, true, 90, true),
  ('INST-SINK-RITE-STANDARD-SCRAP', 'Sink-Rite Only - (standard scrap sprayer water connection)', 'INSTALL EQUIPMENT', 'Sink-Rite Only - (standard scrap sprayer water connection)', 8050, true, true, true, 100, true),
  ('INST-SINK-RITE-BUILD-UP', 'Sink-Rite Only - (need to build-up faucet water connection) add', 'INSTALL EQUIPMENT', 'Sink-Rite Only - (need to build-up faucet water connection) add', 1680, true, true, true, 110, true),
  ('INST-SINK-RITE-TEE-WATER', 'Sink-Rite Only - (need to tee to water supply  under sink) add', 'INSTALL EQUIPMENT', 'Sink-Rite Only - (need to tee to water supply  under sink) add', 2450, true, true, true, 120, true),
  ('INST-FUN-PUMP', 'Fun Pump (each)', 'INSTALL EQUIPMENT', 'Fun Pump (each)', 7000, true, true, true, 130, true),
  ('INST-DEMA-WALL-PUMP', 'Dema Wall Pump (each)', 'INSTALL EQUIPMENT', 'Dema Wall Pump (each)', 7210, true, true, true, 140, true),
  ('INST-DEMA-WALL-PUMP-KIT', 'Dema Wall Pump Kit Complete', 'INSTALL EQUIPMENT', 'Dema Wall Pump Kit Complete', 9800, true, true, true, 150, true),
  ('INST-GREASE-TRAP-MANITAINER', 'Install Grease Trap Manitainer', 'INSTALL EQUIPMENT', 'Install Grease Trap Manitainer', 7700, true, true, true, 160, true),
  ('INST-AFVT-VEGGIE-WASH-SYSTEM', 'AFVT Veggie Wash System', 'INSTALL EQUIPMENT', 'AFVT Veggie Wash System', 10500, true, true, true, 170, true),
  ('INST-HAND-SOAP-DISPENSER-NOT', 'Hand Soap Dispenser (not in install kit) each.', 'INSTALL EQUIPMENT', 'Hand Soap Dispenser (not in install kit) each.', 700, true, true, true, 180, true),
  ('PM-PREVENTIVE-MAINTENANCE-DM-RENTAL', 'Preventive Maintenance of DM Rental and Equipment', 'PM - Value Visit', 'Preventive Maintenance of DM Rental and Equipment', 9800, true, true, true, 190, true),
  ('PM-CHANGE-OUT-CHEMICAL-LINES', 'Change-Out Chemical Lines add', 'PM - Value Visit', 'Change-Out Chemical Lines add', 2450, true, true, true, 200, true),
  ('PM-PM-MORE-THAN-ONE', 'PM more than one machine - add per machine', 'PM - Value Visit', 'PM more than one machine - add per machine', 4060, true, true, true, 210, true),
  ('PM-REPLACE-ANY-DISPENSERS-THAT', 'Replace any dispensers that have to be replaced - add per dispenser', 'PM - Value Visit', 'Replace any dispensers that have to be replaced - add per dispenser', 2450, true, true, true, 220, true),
  ('ESR-SERVICE-CALL-SERVICE-REPAIR', 'Service Call (service repair/replace equipment etc.) - 1st Hour', 'ESR - SPECIALIZED REPAIRS', 'Service Call (service repair/replace equipment etc.) - 1st Hour', 11900, true, true, true, 230, true),
  ('ESR-SERVICE-CALL-SERVICE-REPAIR-2', 'Service Call (service repair/replace equipment etc.) - after 1st Hour - Needs Approval', 'ESR - SPECIALIZED REPAIRS', 'Service Call (service repair/replace equipment etc.) - after 1st Hour - Needs Approval', 4060, true, true, true, 240, true),
  ('ESR-SERVICE-CALL-PLUS-SERVICE', 'Service call  (plus service/repair additional dispenser while at location) each.', 'ESR - SPECIALIZED REPAIRS', 'Service call  (plus service/repair additional dispenser while at location) each.', 2450, true, true, true, 250, true),
  ('CONV-WW-CHEM-CONVERSION', 'WW CHEM CONVERSION', 'INSTALL CONVERSION', 'WW CHEM CONVERSION', 10500, true, true, true, 260, true),
  ('CONV-CHANGE-OUT-SQUEEZE-TUBES', 'Change-Out Squeeze Tubes add', 'INSTALL CONVERSION', 'Change-Out Squeeze Tubes add', 2450, true, true, true, 270, true),
  ('CONV-CHANGE-OUT-CHEMICAL-LINES', 'Change-Out Chemical Lines add', 'INSTALL CONVERSION', 'Change-Out Chemical Lines add', 2450, true, true, true, 280, true),
  ('CONV-CONVERTING-MORE-THAN-ONE', 'Converting more than one machine - add per machine', 'INSTALL CONVERSION', 'Converting more than one machine - add per machine', 8050, true, true, true, 290, true),
  ('DMI-SINGLE-RACK-LOW-TEMP', 'SINGLE RACK INSTALL LOW TEMP - FLAT FEE', 'DM INSTALL', 'SINGLE RACK INSTALL LOW TEMP - FLAT FEE', 25900, true, true, true, 300, true),
  ('DMI-UNDERCOUNTER-LOW-TEMP', 'UNDERCOUNTER INSTALL LOW TEMP - FLAT FEE', 'DM INSTALL', 'UNDERCOUNTER INSTALL LOW TEMP - FLAT FEE', 25900, true, true, true, 310, true),
  ('DMI-UNDERCOUNTER-HIGH-TEMP', 'UNDERCOUNTER INSTALL HIGH TEMP - FLAT FEE', 'DM INSTALL', 'UNDERCOUNTER INSTALL HIGH TEMP - FLAT FEE', 30100, true, true, true, 320, true),
  ('DMI-DOUBLE-RACK', 'DOUBLE RACK INSTALL - FLAT FEE', 'DM INSTALL', 'DOUBLE RACK INSTALL - FLAT FEE', 39900, true, true, true, 330, true),
  ('DMI-SINGLE-RACK-HIGH-TEMP', 'SINGLE RACK INSTALL HIGH TEMP - FLAT FEE', 'DM INSTALL', 'SINGLE RACK INSTALL HIGH TEMP - FLAT FEE', 30100, true, true, true, 340, true),
  ('DMI-44-CONVERYOR', '44" CONVERYOR INSTALL - FLAT FEE', 'DM INSTALL', '44" CONVERYOR INSTALL - FLAT FEE', 49000, true, true, true, 350, true),
  ('DMI-66-CONVERYOR', '66" CONVERYOR INSTALL  - FLAT FEE', 'DM INSTALL', '66" CONVERYOR INSTALL  - FLAT FEE', 64000, true, true, true, 360, true),
  ('DMI-BOOSTER-HEATER', 'BOOSTER HEATER INSTALL', 'DM INSTALL', 'BOOSTER HEATER INSTALL', 19950, true, true, true, 370, true),
  ('DMI-ADDITION-LABOR-ALLOWANCE-HR', 'ADDITION LABOR ALLOWANCE / HR RATE PER HOUR (NEED APPROVAL)', 'DM INSTALL', 'ADDITION LABOR ALLOWANCE / HR RATE PER HOUR (NEED APPROVAL)', 4060, true, true, true, 380, true),
  ('DMD-300L-OR-200L-LIQUID', '300L OR 200L (LIQUID CHEMICALS)', 'DM DISP INSTALL', '300L OR 200L (LIQUID CHEMICALS)', 28000, true, true, true, 390, true),
  ('DMD-300D-OR-200D-SOLID', '300D OR 200D (SOLID CHEMICALS) Needs Water Source', 'DM DISP INSTALL', '300D OR 200D (SOLID CHEMICALS) Needs Water Source', 30100, true, true, true, 400, true),
  ('DMD-POWER-BOWL-WATER-SOURCE', 'POWER BOWL Needs Water Source', 'DM DISP INSTALL', 'POWER BOWL Needs Water Source', 10150, true, true, true, 410, true),
  ('DMD-GEOCENTER-WATER-SOURCE', 'GEOCENTER Needs Water Source', 'DM DISP INSTALL', 'GEOCENTER Needs Water Source', 30100, true, true, true, 420, true),
  ('DMD-RINSE-MAX-SOLID-WATER', 'RINSE MAX SOLID Needs Water Source', 'DM DISP INSTALL', 'RINSE MAX SOLID Needs Water Source', 10150, true, true, true, 430, true),
  ('DMD-WASH-MAX-SOLID-WATER', 'WASH MAX SOLID Needs Water Source', 'DM DISP INSTALL', 'WASH MAX SOLID Needs Water Source', 10150, true, true, true, 440, true),
  ('DMD-PUMP', 'ADD A PUMP', 'DM DISP INSTALL', 'ADD A PUMP', 4060, true, true, true, 450, true),
  ('REM-SINGLE-RACK-REMOVAL', 'SINGLE RACK REMOVAL', 'REMOVAL', 'SINGLE RACK REMOVAL', 14000, true, true, true, 460, true),
  ('REM-UNDERCOUNTER-REMOVAL', 'UNDERCOUNTER REMOVAL', 'REMOVAL', 'UNDERCOUNTER REMOVAL', 14000, true, true, true, 470, true),
  ('REM-DOUBLE-RACK-REMOVAL', 'DOUBLE RACK REMOVAL', 'REMOVAL', 'DOUBLE RACK REMOVAL', 19950, true, true, true, 480, true),
  ('REM-44-CONVEYOR-REMOVAL', '44" CONVEYOR REMOVAL', 'REMOVAL', '44" CONVEYOR REMOVAL', 28000, true, true, true, 490, true),
  ('REM-66-CONVEYOR-REMOVAL', '66" CONVEYOR REMOVAL', 'REMOVAL', '66" CONVEYOR REMOVAL', 36050, true, true, true, 500, true),
  ('REM-ADDITION-LABOR-ALLOWANCE-HR', 'ADDITION LABOR ALLOWANCE / HR RATE PER HOUR (NEED APPROVAL)', 'REMOVAL', 'ADDITION LABOR ALLOWANCE / HR RATE PER HOUR (NEED APPROVAL)', 4060, true, true, true, 510, true),
  ('REM-MACHINE-TRANSPORT', 'MACHINE TRANSPORT', 'REMOVAL', 'MACHINE TRANSPORT', 16100, true, true, true, 520, true),
  ('SWAP-LT-SINGLE-RACK-UNDERCOUNTER', 'LT SINGLE RACK & UNDERCOUNTER SWAPOUT - FLAT FEE', 'SWAP-OUT', 'LT SINGLE RACK & UNDERCOUNTER SWAPOUT - FLAT FEE', 40250, true, true, true, 530, true),
  ('SWAP-HT-UNDERCOUNTER-SWAPOUT', 'HT UNDERCOUNTER SWAPOUT - FLAT FEE', 'SWAP-OUT', 'HT UNDERCOUNTER SWAPOUT - FLAT FEE', 44100, true, true, true, 540, true),
  ('SWAP-DOUBLE-RACK-SWAPOUT', 'DOUBLE RACK SWAPOUT - FLAT FEE', 'SWAP-OUT', 'DOUBLE RACK SWAPOUT - FLAT FEE', 56000, true, true, true, 550, true),
  ('SWAP-SINGLE-RACK-HIGH-TEMP', 'SINGLE RACK INSTALL HIGH TEMP SWAP-OUT - FLAT FEE', 'SWAP-OUT', 'SINGLE RACK INSTALL HIGH TEMP SWAP-OUT - FLAT FEE', 47950, true, true, true, 560, true),
  ('SWAP-44-CONVERYOR-SWAP-OUT', '44" CONVERYOR SWAP-OUT - FLAT FEE', 'SWAP-OUT', '44" CONVERYOR SWAP-OUT - FLAT FEE', 72100, true, true, true, 570, true),
  ('SWAP-66-CONVERYOR-SWAPOUT', '66" CONVERYOR SWAPOUT  - FLAT FEE', 'SWAP-OUT', '66" CONVERYOR SWAPOUT  - FLAT FEE', 95900, true, true, true, 580, true),
  ('SWAP-ADDITION-LABOR-ALLOWANCE-HR', 'ADDITION LABOR ALLOWANCE / HR RATE PER HOUR (NEED APPROVAL)', 'SWAP-OUT', 'ADDITION LABOR ALLOWANCE / HR RATE PER HOUR (NEED APPROVAL)', 4060, true, true, true, 590, true),
  ('SWAP-BOOSTER-HEATER-SWAPOUT', 'BOOSTER HEATER SWAPOUT', 'SWAP-OUT', 'BOOSTER HEATER SWAPOUT', 19950, true, true, true, 600, true),
  ('TRN-TRAINING-CUSTOMER-ON-OPERATION', 'TRAINING CUSTOMER ON OPERATION OF MACHINE & FIVE FACTORS OF CLEAN', 'TRAINING ON DM ONLY', 'TRAINING CUSTOMER ON OPERATION OF MACHINE & FIVE FACTORS OF CLEAN', 3500, true, true, true, 610, true),
  ('TRNIS-COMPLETE-CUSTOMER-TRAINING-IN', '"COMPLETE" CUSTOMER TRAINING AND IN-SERVICE (SPECIALIZED- SEPARATE )', 'TRAINING & IN-SERVICE', '"COMPLETE" CUSTOMER TRAINING AND IN-SERVICE (SPECIALIZED- SEPARATE )', 12040, true, true, true, 620, true),
  ('LNDRY-ONE-SHOT', 'ONE SHOT', 'INSTALLATION LAUNDRY', 'ONE SHOT', 8050, true, true, true, 630, true),
  ('LNDRY-TWO-PRODUCT-DISPENSER', 'TWO PRODUCT DISPENSER', 'INSTALLATION LAUNDRY', 'TWO PRODUCT DISPENSER', 16100, true, true, true, 640, true),
  ('LNDRY-ADVANCED-LAUNDRY-SYSTEM-OPL', 'Advanced Laundry System (OPL)', 'INSTALLATION LAUNDRY', 'Advanced Laundry System (OPL)', 28000, true, true, true, 650, true),
  ('LNDRY-PROGRAMING-SETTING-CYCLES', 'Programing (setting cycles)', 'INSTALLATION LAUNDRY', 'Programing (setting cycles)', 16100, true, true, true, 660, true),
  ('ZONE-7-ELEVEN', '7-ELEVEN', 'Zone Install Program', '7-ELEVEN', 15000, true, true, true, 670, true),
  ('ZONE-BEK-ODYSSEY-PROGRAM', 'BEK ODYSSEY PROGRAM', 'Zone Install Program', 'BEK ODYSSEY PROGRAM', 14500, true, true, true, 680, true),
  ('ZONE-BLAZE-PIZZA', 'BLAZE PIZZA', 'Zone Install Program', 'BLAZE PIZZA', 22000, true, true, true, 690, true),
  ('ZONE-CARL-S-JR-CKE', 'CARL''S JR CKE PROGRAM', 'Zone Install Program', 'CARL''S JR CKE PROGRAM', 22000, true, true, true, 700, true),
  ('ZONE-CASEYS-W-O-AFVT', 'CASEYS W/O AFVT', 'Zone Install Program', 'CASEYS W/O AFVT', 22000, true, true, true, 710, true),
  ('ZONE-CASEYS-AFVT', 'CASEYS+AFVT', 'Zone Install Program', 'CASEYS+AFVT', 32000, true, true, true, 720, true),
  ('ZONE-CHEVRON', 'CHEVRON', 'Zone Install Program', 'CHEVRON', 14500, true, true, true, 730, true),
  ('ZONE-C-STORE-PROGRAM', 'C-STORE A PROGRAM', 'Zone Install Program', 'C-STORE A PROGRAM', 14500, true, true, true, 740, true),
  ('ZONE-DICKEY-S-BBQ', 'DICKEY''S BBQ', 'Zone Install Program', 'DICKEY''S BBQ', 17500, true, true, true, 750, true),
  ('ZONE-DOMINO-S', 'DOMINO''S', 'Zone Install Program', 'DOMINO''S', 15000, true, true, true, 760, true),
  ('ZONE-EG-GROUP', 'EG GROUP', 'Zone Install Program', 'EG GROUP', 17500, true, true, true, 770, true),
  ('ZONE-FUZZY-TACOS', 'FUZZY TACOS', 'Zone Install Program', 'FUZZY TACOS', 17500, true, true, true, 780, true),
  ('ZONE-GOLDEN-CHICK', 'GOLDEN CHICK', 'Zone Install Program', 'GOLDEN CHICK', 16000, true, true, true, 790, true),
  ('ZONE-HARDEE-S-CKE-PROGRAM', 'HARDEE''S CKE PROGRAM', 'Zone Install Program', 'HARDEE''S CKE PROGRAM', 22000, true, true, true, 800, true),
  ('ZONE-HUDDLE-HOUSE', 'HUDDLE HOUSE', 'Zone Install Program', 'HUDDLE HOUSE', 15000, true, true, true, 810, true),
  ('ZONE-HUNGRY-HOWIE-S', 'HUNGRY HOWIE''S', 'Zone Install Program', 'HUNGRY HOWIE''S', 14500, true, true, true, 820, true),
  ('ZONE-JACK-IN-BOX', 'JACK IN THE BOX', 'Zone Install Program', 'JACK IN THE BOX', 22000, true, true, true, 830, true),
  ('ZONE-JAMBA-JUICE', 'JAMBA JUICE', 'Zone Install Program', 'JAMBA JUICE', 17500, true, true, true, 840, true),
  ('ZONE-KROGER', 'KROGER', 'Zone Install Program', 'KROGER', 17500, true, true, true, 850, true),
  ('ZONE-LITTLE-CAESARS', 'LITTLE CAESARS', 'Zone Install Program', 'LITTLE CAESARS', 16000, true, true, true, 860, true),
  ('ZONE-MAVERIK', 'MAVERIK', 'Zone Install Program', 'MAVERIK', 14500, true, true, true, 870, true),
  ('ZONE-MCALISTER-S', 'MCALISTER''S', 'Zone Install Program', 'MCALISTER''S', 16000, true, true, true, 880, true),
  ('ZONE-MENCHIE-S', 'MENCHIE''S', 'Zone Install Program', 'MENCHIE''S', 14500, true, true, true, 890, true),
  ('ZONE-PAPA-JOHN-S', 'PAPA JOHN''S', 'Zone Install Program', 'PAPA JOHN''S', 16000, true, true, true, 900, true),
  ('ZONE-PFG-PROGRAM', 'PFG A PROGRAM', 'Zone Install Program', 'PFG A PROGRAM', 14500, true, true, true, 910, true),
  ('ZONE-PIE-FIVE', 'PIE FIVE', 'Zone Install Program', 'PIE FIVE', 14000, true, true, true, 920, true),
  ('ZONE-PIZZA-INN', 'PIZZA INN', 'Zone Install Program', 'PIZZA INN', 14000, true, true, true, 930, true),
  ('ZONE-QDOBA', 'QDOBA', 'Zone Install Program', 'QDOBA', 14000, true, true, true, 940, true),
  ('ZONE-SBARRO', 'SBARRO', 'Zone Install Program', 'SBARRO', 14500, true, true, true, 950, true),
  ('ZONE-SCHLOTZSKY-S', 'SCHLOTZSKY''S', 'Zone Install Program', 'SCHLOTZSKY''S', 29500, true, true, true, 960, true),
  ('ZONE-SONIC', 'SONIC', 'Zone Install Program', 'SONIC', 17500, true, true, true, 970, true),
  ('ZONE-SOUTHWEST-TRADERS', 'SOUTHWEST TRADERS', 'Zone Install Program', 'SOUTHWEST TRADERS', 16000, true, true, true, 980, true),
  ('ZONE-SSDC-PROGRAM', 'SSDC A-PROGRAM', 'Zone Install Program', 'SSDC A-PROGRAM', 14500, true, true, true, 990, true),
  ('ZONE-SUBWAY', 'SUBWAY', 'Zone Install Program', 'SUBWAY', 14500, true, true, true, 1000, true),
  ('ZONE-TACO-BUENO', 'TACO BUENO', 'Zone Install Program', 'TACO BUENO', 23500, true, true, true, 1010, true),
  ('ZONE-TEXAS-DAIRY-QUEEN', 'TEXAS DAIRY QUEEN', 'Zone Install Program', 'TEXAS DAIRY QUEEN', 16000, true, true, true, 1020, true),
  ('ZONE-WHATABURGER-PEROXIDE-MOP-SYSTEM', 'WHATABURGER WITH PEROXIDE MOP SYSTEM', 'Zone Install Program', 'WHATABURGER WITH PEROXIDE MOP SYSTEM', 18500, true, true, true, 1030, true),
  ('ZONE-WINGSTOP', 'WINGSTOP', 'Zone Install Program', 'WINGSTOP', 17500, true, true, true, 1040, true)
on conflict (code) do nothing;

