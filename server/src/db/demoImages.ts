// Placeholder KYC images for the demo accounts: drawn from SVG, so no real NID ever ships with
// the seed. They go through processImage like an upload, so they are stored exactly as at
// registration (WebP, documents mode).
import sharp from 'sharp';
import { processImage, type ProcessedImage } from '../lib/images';
import { maskNid } from '../utils/mask';

interface DemoPerson {
  name: string;
  nidNumber: string;
}

const FONT = 'font-family="DejaVu Sans, Arial, sans-serif"';

/** An 856×540 ID card (the ID-1 card ratio). Only the masked NID is drawn. */
export function demoIdCardSvg(p: DemoPerson, side: 'front' | 'back'): string {
  const lines =
    side === 'front'
      ? [`Name: ${p.name}`, `NID: ${maskNid(p.nidNumber)}`, 'Date of birth: 01 Jan 1995']
      : [`Name: ${p.name}`, `NID: ${maskNid(p.nidNumber)}`, 'Back side · PocketPay demo data'];
  const x = side === 'front' ? 296 : 56;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="856" height="540">
  <rect width="856" height="540" rx="28" fill="#F4EFE6"/>
  <rect x="16" y="16" width="824" height="508" rx="20" fill="none" stroke="#1F5E4B" stroke-width="6"/>
  <rect x="16" y="16" width="824" height="96" rx="20" fill="#1F5E4B"/>
  <text x="428" y="80" text-anchor="middle" ${FONT} font-size="40" font-weight="bold" fill="#FFFFFF">DEMO — NOT A REAL NID</text>
  ${side === 'front' ? '<rect x="56" y="160" width="200" height="250" rx="12" fill="#D8CFC0"/>' : ''}
  ${lines.map((line, i) => `<text x="${x}" y="${210 + i * 64}" ${FONT} font-size="34" fill="#2B2B2B">${line}</text>`).join('\n  ')}
  <text x="428" y="490" text-anchor="middle" ${FONT} font-size="26" fill="#B3412E">DEMO — NOT A REAL NID</text>
</svg>`;
}

/** A 600×800 selfie placeholder: the initials on a tinted circle. */
function demoSelfieSvg(p: DemoPerson): string {
  const initials = p.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
  <rect width="600" height="800" fill="#F4EFE6"/>
  <circle cx="300" cy="360" r="200" fill="#CFE3DA"/>
  <text x="300" y="410" text-anchor="middle" ${FONT} font-size="150" font-weight="bold" fill="#1F5E4B">${initials}</text>
  <text x="300" y="700" text-anchor="middle" ${FONT} font-size="30" fill="#B3412E">DEMO SELFIE — NOT A REAL PERSON</text>
</svg>`;
}

const render = async (svg: string) =>
  processImage(await sharp(Buffer.from(svg)).png().toBuffer(), { mode: 'document' });

/** The 3 KYC images of one demo person, ready for storage.put. */
export async function demoKycImages(
  p: DemoPerson,
): Promise<{ nidFront: ProcessedImage; nidBack: ProcessedImage; selfie: ProcessedImage }> {
  const [nidFront, nidBack, selfie] = await Promise.all([
    render(demoIdCardSvg(p, 'front')),
    render(demoIdCardSvg(p, 'back')),
    render(demoSelfieSvg(p)),
  ]);
  return { nidFront, nidBack, selfie };
}
