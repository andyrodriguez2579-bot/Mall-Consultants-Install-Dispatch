/**
 * JG Installations' own fixed rate card.
 *
 * JG is who pays Mall Consultants for a job -- not the customer, and not the
 * contractor. They set these prices; Mall Consultants does not. That is why
 * this is a hardcoded constant rather than a price_list_items-style table an
 * administrator edits: there is nothing to edit here, only items to select
 * per job and quantities to enter, the same way `job_service_lines` selects
 * from the customer price list.
 *
 * Extracted programmatically from the workbook JG actually uses (a real,
 * filled example: "Stoney Brook Grill"), not transcribed by hand -- these are
 * real payment amounts, and a typo here is money Mall Consultants is shorted
 * or overpaid on every job that uses it.
 *
 * `id` is a stable slug, not a database id: this list has no table of its
 * own, so a submission line snapshots the category/description/price it
 * matched at the time (same reasoning as job_service_lines "copied, never
 * followed") and keeps `id` only to prefill the picker.
 */

export interface JgRateCardItem {
  id: string;
  category: string;
  description: string;
  unitPriceCents: number;
}

export const JG_RATE_CARD: JgRateCardItem[] = [
  { id: "stop-charge--truck-stop-charge-no-sink-no-kit-job-cannot-be-completed", category: "STOP CHARGE", description: "Truck Stop Charge ( no sink / no kit / job cannot be completed)", unitPriceCents: 6790 },
  { id: "stop-charge--truck-stop-charge-survey-account", category: "STOP CHARGE", description: "Truck Stop Charge (survey account)", unitPriceCents: 8050 },
  { id: "old-equipment-removal--remove-all-existing-equipment-signage-per-location", category: "OLD EQUIPMENT REMOVAL", description: "Remove all existing equipment & signage per location", unitPriceCents: 2450 },
  { id: "install-equipment--a-program-standard-scrap-sprayer-water-connection", category: "INSTALL EQUIPMENT", description: "A-Program - (standard scrap sprayer water connection)", unitPriceCents: 12040 },
  { id: "install-equipment--a-program-need-to-build-up-faucet-water-connection-add", category: "INSTALL EQUIPMENT", description: "A-Program - (need to build-up faucet water connection) add", unitPriceCents: 1750 },
  { id: "install-equipment--a-program-need-to-tee-to-water-supply-under-sink-add", category: "INSTALL EQUIPMENT", description: "A-Program - (need to tee to water supply  under sink) add", unitPriceCents: 2450 },
  { id: "install-equipment--moprite-iii", category: "INSTALL EQUIPMENT", description: "Moprite III", unitPriceCents: 8050 },
  { id: "install-equipment--moprite-ii", category: "INSTALL EQUIPMENT", description: "Moprite II", unitPriceCents: 7630 },
  { id: "install-equipment--sink-rite-solo", category: "INSTALL EQUIPMENT", description: "Sink-Rite Solo", unitPriceCents: 7280 },
  { id: "install-equipment--sink-rite-only-standard-scrap-sprayer-water-connection", category: "INSTALL EQUIPMENT", description: "Sink-Rite Only - (standard scrap sprayer water connection)", unitPriceCents: 8050 },
  { id: "install-equipment--sink-rite-only-need-to-build-up-faucet-water-connection-add", category: "INSTALL EQUIPMENT", description: "Sink-Rite Only - (need to build-up faucet water connection) add", unitPriceCents: 1680 },
  { id: "install-equipment--sink-rite-only-need-to-tee-to-water-supply-under-sink-add", category: "INSTALL EQUIPMENT", description: "Sink-Rite Only - (need to tee to water supply  under sink) add", unitPriceCents: 2450 },
  { id: "install-equipment--fun-pump-each", category: "INSTALL EQUIPMENT", description: "Fun Pump (each)", unitPriceCents: 7000 },
  { id: "install-equipment--dema-wall-pump-each", category: "INSTALL EQUIPMENT", description: "Dema Wall Pump (each)", unitPriceCents: 7210 },
  { id: "install-equipment--dema-wall-pump-kit-complete", category: "INSTALL EQUIPMENT", description: "Dema Wall Pump Kit Complete", unitPriceCents: 9800 },
  { id: "install-equipment--install-grease-trap-manitainer", category: "INSTALL EQUIPMENT", description: "Install Grease Trap Manitainer", unitPriceCents: 7700 },
  { id: "install-equipment--afvt-veggie-wash-system", category: "INSTALL EQUIPMENT", description: "AFVT Veggie Wash System", unitPriceCents: 10500 },
  { id: "install-equipment--hand-soap-dispenser-not-in-install-kit-each", category: "INSTALL EQUIPMENT", description: "Hand Soap Dispenser (not in install kit) each.", unitPriceCents: 700 },
  { id: "pm-value-visit--preventive-maintenance-of-dm-rental-and-equipment", category: "PM - Value Visit", description: "Preventive Maintenance of DM Rental and Equipment", unitPriceCents: 9800 },
  { id: "pm-value-visit--change-out-chemical-lines-add", category: "PM - Value Visit", description: "Change-Out Chemical Lines add", unitPriceCents: 2450 },
  { id: "pm-value-visit--pm-more-than-one-machine-add-per-machine", category: "PM - Value Visit", description: "PM more than one machine - add per machine", unitPriceCents: 4060 },
  { id: "pm-value-visit--replace-any-dispensers-that-have-to-be-replaced-add-per-disp", category: "PM - Value Visit", description: "Replace any dispensers that have to be replaced - add per dispenser", unitPriceCents: 2450 },
  { id: "esr-specialized-repairs--service-call-service-repair-replace-equipment-etc-1st-hour", category: "ESR - SPECIALIZED REPAIRS", description: "Service Call (service repair/replace equipment etc.) - 1st Hour", unitPriceCents: 11900 },
  { id: "esr-specialized-repairs--service-call-service-repair-replace-equipment-etc-after-1st-", category: "ESR - SPECIALIZED REPAIRS", description: "Service Call (service repair/replace equipment etc.) - after 1st Hour - Needs Approval", unitPriceCents: 4060 },
  { id: "esr-specialized-repairs--service-call-plus-service-repair-additional-dispenser-while-", category: "ESR - SPECIALIZED REPAIRS", description: "Service call  (plus service/repair additional dispenser while at location) each.", unitPriceCents: 2450 },
  { id: "install-conversion--ww-chem-conversion", category: "INSTALL CONVERSION", description: "WW CHEM CONVERSION", unitPriceCents: 10500 },
  { id: "install-conversion--change-out-squeeze-tubes-add", category: "INSTALL CONVERSION", description: "Change-Out Squeeze Tubes add", unitPriceCents: 2450 },
  { id: "install-conversion--change-out-chemical-lines-add", category: "INSTALL CONVERSION", description: "Change-Out Chemical Lines add", unitPriceCents: 2450 },
  { id: "install-conversion--converting-more-than-one-machine-add-per-machine", category: "INSTALL CONVERSION", description: "Converting more than one machine - add per machine", unitPriceCents: 8050 },
  { id: "dm-install--single-rack-install-low-temp-flat-fee", category: "DM INSTALL", description: "SINGLE RACK INSTALL LOW TEMP - FLAT FEE", unitPriceCents: 25900 },
  { id: "dm-install--undercounter-install-low-temp-flat-fee", category: "DM INSTALL", description: "UNDERCOUNTER INSTALL LOW TEMP - FLAT FEE", unitPriceCents: 25900 },
  { id: "dm-install--undercounter-install-high-temp-flat-fee", category: "DM INSTALL", description: "UNDERCOUNTER INSTALL HIGH TEMP - FLAT FEE", unitPriceCents: 30100 },
  { id: "dm-install--double-rack-install-flat-fee", category: "DM INSTALL", description: "DOUBLE RACK INSTALL - FLAT FEE", unitPriceCents: 39900 },
  { id: "dm-install--single-rack-install-high-temp-flat-fee", category: "DM INSTALL", description: "SINGLE RACK INSTALL HIGH TEMP - FLAT FEE", unitPriceCents: 30100 },
  { id: "dm-install--44-converyor-install-flat-fee", category: "DM INSTALL", description: "44\" CONVERYOR INSTALL - FLAT FEE", unitPriceCents: 49000 },
  { id: "dm-install--66-converyor-install-flat-fee", category: "DM INSTALL", description: "66\" CONVERYOR INSTALL  - FLAT FEE", unitPriceCents: 64000 },
  { id: "dm-install--booster-heater-install", category: "DM INSTALL", description: "BOOSTER HEATER INSTALL", unitPriceCents: 19950 },
  { id: "dm-install--addition-labor-allowance-hr-rate-per-hour-need-approval", category: "DM INSTALL", description: "ADDITION LABOR ALLOWANCE / HR RATE PER HOUR (NEED APPROVAL)", unitPriceCents: 4060 },
  { id: "dm-disp-install--300l-or-200l-liquid-chemicals", category: "DM DISP INSTALL", description: "300L OR 200L (LIQUID CHEMICALS)", unitPriceCents: 28000 },
  { id: "dm-disp-install--300d-or-200d-solid-chemicals-needs-water-source", category: "DM DISP INSTALL", description: "300D OR 200D (SOLID CHEMICALS) Needs Water Source", unitPriceCents: 30100 },
  { id: "dm-disp-install--power-bowl-needs-water-source", category: "DM DISP INSTALL", description: "POWER BOWL Needs Water Source", unitPriceCents: 10150 },
  { id: "dm-disp-install--geocenter-needs-water-source", category: "DM DISP INSTALL", description: "GEOCENTER Needs Water Source", unitPriceCents: 30100 },
  { id: "dm-disp-install--rinse-max-solid-needs-water-source", category: "DM DISP INSTALL", description: "RINSE MAX SOLID Needs Water Source", unitPriceCents: 10150 },
  { id: "dm-disp-install--wash-max-solid-needs-water-source", category: "DM DISP INSTALL", description: "WASH MAX SOLID Needs Water Source", unitPriceCents: 10150 },
  { id: "dm-disp-install--add-a-pump", category: "DM DISP INSTALL", description: "ADD A PUMP", unitPriceCents: 4060 },
  { id: "removal--single-rack-removal", category: "REMOVAL", description: "SINGLE RACK REMOVAL", unitPriceCents: 14000 },
  { id: "removal--undercounter-removal", category: "REMOVAL", description: "UNDERCOUNTER REMOVAL", unitPriceCents: 14000 },
  { id: "removal--double-rack-removal", category: "REMOVAL", description: "DOUBLE RACK REMOVAL", unitPriceCents: 19950 },
  { id: "removal--44-conveyor-removal", category: "REMOVAL", description: "44\" CONVEYOR REMOVAL", unitPriceCents: 28000 },
  { id: "removal--66-conveyor-removal", category: "REMOVAL", description: "66\" CONVEYOR REMOVAL", unitPriceCents: 36050 },
  { id: "removal--addition-labor-allowance-hr-rate-per-hour-need-approval", category: "REMOVAL", description: "ADDITION LABOR ALLOWANCE / HR RATE PER HOUR (NEED APPROVAL)", unitPriceCents: 4060 },
  { id: "removal--machine-transport", category: "REMOVAL", description: "MACHINE TRANSPORT", unitPriceCents: 16100 },
  { id: "swap-out--lt-single-rack-undercounter-swapout-flat-fee", category: "SWAP-OUT", description: "LT SINGLE RACK & UNDERCOUNTER SWAPOUT - FLAT FEE", unitPriceCents: 40250 },
  { id: "swap-out--ht-undercounter-swapout-flat-fee", category: "SWAP-OUT", description: "HT UNDERCOUNTER SWAPOUT - FLAT FEE", unitPriceCents: 44100 },
  { id: "swap-out--double-rack-swapout-flat-fee", category: "SWAP-OUT", description: "DOUBLE RACK SWAPOUT - FLAT FEE", unitPriceCents: 56000 },
  { id: "swap-out--single-rack-install-high-temp-swap-out-flat-fee", category: "SWAP-OUT", description: "SINGLE RACK INSTALL HIGH TEMP SWAP-OUT - FLAT FEE", unitPriceCents: 47950 },
  { id: "swap-out--44-converyor-swap-out-flat-fee", category: "SWAP-OUT", description: "44\" CONVERYOR SWAP-OUT - FLAT FEE", unitPriceCents: 72100 },
  { id: "swap-out--66-converyor-swapout-flat-fee", category: "SWAP-OUT", description: "66\" CONVERYOR SWAPOUT  - FLAT FEE", unitPriceCents: 95900 },
  { id: "swap-out--addition-labor-allowance-hr-rate-per-hour-need-approval", category: "SWAP-OUT", description: "ADDITION LABOR ALLOWANCE / HR RATE PER HOUR (NEED APPROVAL)", unitPriceCents: 4060 },
  { id: "swap-out--booster-heater-swapout", category: "SWAP-OUT", description: "BOOSTER HEATER SWAPOUT", unitPriceCents: 19950 },
  { id: "training-on-dm-only--training-customer-on-operation-of-machine-five-factors-of-cl", category: "TRAINING ON DM ONLY", description: "TRAINING CUSTOMER ON OPERATION OF MACHINE & FIVE FACTORS OF CLEAN", unitPriceCents: 3500 },
  { id: "training-in-service--complete-customer-training-and-in-service-specialized-separa", category: "TRAINING & IN-SERVICE", description: "\"COMPLETE\" CUSTOMER TRAINING AND IN-SERVICE (SPECIALIZED- SEPARATE )", unitPriceCents: 12040 },
  { id: "installation-laundry--one-shot", category: "INSTALLATION LAUNDRY", description: "ONE SHOT", unitPriceCents: 8050 },
  { id: "installation-laundry--two-product-dispenser", category: "INSTALLATION LAUNDRY", description: "TWO PRODUCT DISPENSER", unitPriceCents: 16100 },
  { id: "installation-laundry--advanced-laundry-system-opl", category: "INSTALLATION LAUNDRY", description: "Advanced Laundry System (OPL)", unitPriceCents: 28000 },
  { id: "installation-laundry--programing-setting-cycles", category: "INSTALLATION LAUNDRY", description: "Programing (setting cycles)", unitPriceCents: 16100 },
];

export function jgRateCardItem(id: string): JgRateCardItem | undefined {
  return JG_RATE_CARD.find((item) => item.id === id);
}
