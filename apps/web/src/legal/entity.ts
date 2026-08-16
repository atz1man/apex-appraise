/**
 * Who is behind this product, in the one place that says so.
 *
 * UK law requires an operator to identify itself: a company's registered name,
 * number and office on its site (Companies Act 2006 s.82), the same plus contact
 * details before someone buys (Consumer Contracts / e-commerce regulations), and
 * a named controller with an ICO registration under UK GDPR.
 *
 * The footer already claimed "Apex Appraise Ltd, registered in England & Wales"
 * without any of it being stated anywhere. That claim is either true and
 * incomplete, or it is not true — both are worth fixing before the first invoice,
 * and neither is mine to decide. So the values live here, `confirmed` is the
 * switch, and the pages tell the reader plainly which state they are in rather
 * than printing a company number nobody checked.
 */

/**
 * The trial length, in the one place the site and the terms both read it from.
 *
 * The pricing footnote sold "14-day trial" for weeks while the code granted a
 * trial that never ended. Marketing and enforcement disagreeing is either a free
 * tier nobody costed or a promise nobody kept, depending on which way the gap
 * runs — so the number lives here, and `apps/api/src/trial.ts` holds the same one
 * with a test pinning it.
 */
export const TRIAL_DAYS = 14;

export interface LegalEntity {
  /** false until the owner has filled in and checked every field below */
  confirmed: boolean;
  name: string;
  companyNumber: string;
  registeredOffice: string;
  vatNumber: string;
  /** ICO data-protection register entry (required for a UK controller) */
  icoRegistration: string;
  privacyContact: string;
  supportContact: string;
  /** the law the terms are written under */
  governingLaw: string;
}

export const ENTITY: LegalEntity = {
  confirmed: false,
  name: 'Apex Appraise Ltd',
  companyNumber: '',
  registeredOffice: '',
  vatNumber: '',
  icoRegistration: '',
  privacyContact: 'privacy@apexappraise.co.uk',
  supportContact: 'support@apexappraise.co.uk',
  governingLaw: 'England and Wales',
};

/** The one line that must never claim more than has been filled in. */
export const entityLine = () =>
  ENTITY.confirmed
    ? `${ENTITY.name}, company number ${ENTITY.companyNumber}, registered office ${ENTITY.registeredOffice}.`
    : `${ENTITY.name}. Company registration and VAT details are being finalised and will be published here before any paid subscription is sold.`;

/**
 * Every third party that touches customer data, and what for. A privacy notice
 * has to list these; keeping them in code means the notice cannot fall behind the
 * integrations, because adding one without touching this list is a visible
 * omission rather than an invisible one.
 */
export const SUBPROCESSORS: Array<{ name: string; purpose: string; where: string }> = [
  { name: 'Fly.io', purpose: 'Application hosting and the PostgreSQL database', where: 'London (lhr)' },
  { name: 'Anthropic', purpose: 'Reading uploaded documents to extract figures, and drafting report narrative', where: 'United States' },
  { name: 'Stripe', purpose: 'Subscription payments and buyer payments', where: 'EU / United States' },
];

/**
 * Public data sources the product queries. Listed separately because nothing
 * personal is sent to them — the flow runs the other way — and conflating the two
 * makes a privacy notice read as though a firm's deals are broadcast to eight
 * government APIs.
 */
export const DATA_SOURCES = [
  'postcodes.io',
  'HM Land Registry Price Paid Data',
  'planning.data.gov.uk',
  'EPC Open Data',
  'OpenStreetMap / Overpass',
];
