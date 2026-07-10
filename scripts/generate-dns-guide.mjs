/**
 * Generates: docs/KukuConnect-Vercel-DNS-Guide.pdf
 * Run: node scripts/generate-dns-guide.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "docs");
const outFile = path.join(outDir, "KukuConnect-Vercel-DNS-Guide.pdf");

const PAGE = { width: 595, height: 842, margin: 50 };
const COLORS = {
  charcoal: rgb(0.12, 0.12, 0.12),
  slate: rgb(0.35, 0.35, 0.38),
  primary: rgb(0.47, 0, 0.1),
  line: rgb(0.85, 0.8, 0.78),
  green: rgb(0.05, 0.35, 0.12),
};

async function main() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("KukuConnect - Vercel and DNS Setup Guide");
  pdf.setAuthor("KukuConnect");
  pdf.setProducer("KukuConnect Farm Management");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pages = [];
  let page = pdf.addPage([PAGE.width, PAGE.height]);
  pages.push(page);
  let y = PAGE.height - PAGE.margin;

  const ensureSpace = (need = 40) => {
    if (y < PAGE.margin + need) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      pages.push(page);
      y = PAGE.height - PAGE.margin;
    }
  };

  const drawFooter = (p, font, num) => {
    p.drawText(
      "KukuConnect Farm Management System | kukuconnect@outlook.com",
      {
        x: PAGE.margin,
        y: 28,
        size: 8,
        font,
        color: COLORS.slate,
      }
    );
    const label = "Page " + num;
    const w = font.widthOfTextAtSize(label, 8);
    p.drawText(label, {
      x: PAGE.width - PAGE.margin - w,
      y: 28,
      size: 8,
      font,
      color: COLORS.slate,
    });
  };

  const h1 = (text) => {
    ensureSpace(50);
    page.drawText(text, {
      x: PAGE.margin,
      y,
      size: 16,
      font: bold,
      color: COLORS.primary,
    });
    y -= 26;
  };

  const h2 = (text) => {
    ensureSpace(40);
    y -= 6;
    page.drawText(text, {
      x: PAGE.margin,
      y,
      size: 12,
      font: bold,
      color: COLORS.charcoal,
    });
    y -= 18;
  };

  const body = (text, opts = {}) => {
    const size = opts.size ?? 10;
    const font = opts.bold ? bold : regular;
    const color = opts.color ?? COLORS.charcoal;
    const maxW = PAGE.width - PAGE.margin * 2;
    const words = text.split(/\s+/);
    let line = "";
    const lines = [];
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(test, size) > maxW) {
        if (line) lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    for (const ln of lines) {
      ensureSpace(16);
      page.drawText(ln, { x: PAGE.margin, y, size, font, color });
      y -= size + 5;
    }
    y -= 3;
  };

  const bullet = (text) => body("-  " + text);
  const code = (text) => {
    ensureSpace(16);
    page.drawText(text, {
      x: PAGE.margin + 10,
      y,
      size: 9,
      font: regular,
      color: COLORS.green,
    });
    y -= 14;
  };

  const rule = () => {
    ensureSpace(14);
    page.drawLine({
      start: { x: PAGE.margin, y },
      end: { x: PAGE.width - PAGE.margin, y },
      thickness: 1,
      color: COLORS.line,
    });
    y -= 14;
  };

  h1("KukuConnect - Domain, Vercel and DNS Guide");
  body("Farm Management System - setup guide (no new domain required)");
  body(
    "Generated: " +
      new Date().toLocaleDateString("en-KE", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
  );
  rule();

  h2("1. Your current setup (this is normal)");
  body(
    "You own kukuconnect.co.ke. The marketing website is hosted on Vercel. DNS (name servers / records) is managed somewhere else - for example your registrar, Cloudflare, or a host control panel."
  );
  body(
    "You do NOT need to buy another domain. You do NOT need to move all DNS into Vercel unless you want to."
  );

  h2("2. Recommended architecture");
  body(
    "Keep the marketing site on the main domain. Put this Farm Management app on a free subdomain:"
  );
  bullet(
    "www.kukuconnect.co.ke  =  Marketing site (current Vercel project)"
  );
  bullet(
    "app.kukuconnect.co.ke  =  Farm Management System (this Next.js project)"
  );
  body("Farmers order at:  https://app.kukuconnect.co.ke/order");
  body("Staff login at:     https://app.kukuconnect.co.ke/login");
  body(
    "On the marketing site, add buttons that link to those URLs (Order chicks / Staff)."
  );

  h2("3. Deploy the farm app on Vercel");
  body(
    "A. Push this farm-management repository to GitHub (if not already)."
  );
  body(
    "B. In Vercel: Add New Project - Import the farm-management repository."
  );
  body(
    "C. Framework: Next.js (auto-detected). Deploy once so the project has a .vercel.app URL."
  );
  body(
    "D. Project - Settings - Environment Variables. Set at least:"
  );
  code("NEXT_PUBLIC_SITE_URL=https://app.kukuconnect.co.ke");
  code("NEXT_PUBLIC_MPESA_TILL=your_real_till_or_paybill");
  code("NEXT_PUBLIC_STAFF_PHONE=2547XXXXXXXX");
  code("NEXT_PUBLIC_SUPABASE_URL=...   (only if using Supabase)");
  code("NEXT_PUBLIC_SUPABASE_ANON_KEY=...  (only if using Supabase)");
  body("Redeploy after saving env vars so they apply to production.");

  h2("4. Add domain in Vercel");
  body("1. Open the Farm Management project in Vercel.");
  body("2. Go to Settings - Domains (or Project - Domains).");
  body("3. Add domain: app.kukuconnect.co.ke");
  body(
    "4. Vercel will show the DNS record to create. Usually it is:"
  );
  code("Type:  CNAME");
  code("Name:  app");
  code("Value: cname.vercel-dns.com");
  body(
    "If Vercel shows a different target value, copy exactly what Vercel displays."
  );
  body(
    "5. Leave www.kukuconnect.co.ke on the marketing project. Do not remove it unless you intend to replace the whole public website."
  );

  h2("5. Create the DNS record (where DNS is handled)");
  body(
    "Log into wherever DNS is managed today (not necessarily Vercel):"
  );
  bullet("Cloudflare: DNS - Records - Add record");
  bullet("Namecheap: Advanced DNS - Add new record");
  bullet("GoDaddy / Truehost / other: DNS management or Zone editor");
  body("Add this record:");
  code("CNAME | Host: app | Points to: cname.vercel-dns.com | TTL: Auto");
  body("Notes:");
  bullet("Do not put https:// in the CNAME value.");
  bullet('Host is often just "app" (not the full domain name).');
  bullet(
    "Cloudflare: if SSL stays pending, set the record to DNS only (grey cloud), not proxied."
  );
  body(
    "Wait 5 to 60 minutes for DNS to propagate (sometimes up to a few hours)."
  );

  h2("6. SSL certificate");
  body(
    "Vercel issues HTTPS automatically after DNS is correct. In Domains, status should become Valid or Active. Then open https://app.kukuconnect.co.ke in your browser."
  );

  h2("7. Supabase (only if you use cloud login)");
  body("In Supabase - Authentication - URL configuration:");
  bullet("Site URL: https://app.kukuconnect.co.ke");
  bullet("Redirect URLs: https://app.kukuconnect.co.ke/**");
  body(
    "If not already done, run SQL in Supabase: schema.sql, orders.sql, and optional sales_receipt_fields.sql and brooder.sql."
  );

  h2("8. Smoke test after go-live");
  bullet("Open https://app.kukuconnect.co.ke - dashboard loads");
  bullet("Open /order - place a test farmer order");
  bullet("Staff: confirm paid, check stock, print receipt");
  bullet("Marketing site button opens the correct app URL");

  h2("9. What you do NOT need");
  bullet("A second domain purchase");
  bullet("Moving nameservers fully to Vercel (optional only)");
  bullet("Changing how the www marketing site is hosted");

  h2("10. Troubleshooting");
  body(
    "Domain stuck Invalid in Vercel: recheck CNAME name and value; wait for propagation; check dnschecker.org for app.kukuconnect.co.ke."
  );
  body(
    "SSL / certificate error: wait for Vercel cert; on Cloudflare use DNS-only for the app CNAME."
  );
  body(
    "App works on *.vercel.app but not custom domain: domain is on the wrong Vercel project, or env vars not redeployed."
  );
  body(
    "Supabase login fails: Site URL and redirect URLs must match https://app.kukuconnect.co.ke exactly."
  );

  h2("11. Quick reference");
  code("Marketing:  https://www.kukuconnect.co.ke");
  code("Farm app:   https://app.kukuconnect.co.ke");
  code("Orders:     https://app.kukuconnect.co.ke/order");
  code("Staff:      https://app.kukuconnect.co.ke/login");
  code("DNS:        CNAME  app  ->  cname.vercel-dns.com");

  rule();
  body("Support: kukuconnect@outlook.com", { bold: true });
  body(
    "This guide finishes the domain and DNS workstream for the Farm Management System. You can stop here and build other products; the app remains ready to deploy anytime with the steps above."
  );

  pages.forEach((p, i) => drawFooter(p, regular, i + 1));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, await pdf.save());
  console.log("Wrote", outFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
