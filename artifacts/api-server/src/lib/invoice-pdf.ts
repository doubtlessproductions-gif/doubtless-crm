import PDFDocument from "pdfkit";
import { type invoicesTable } from "@workspace/db";

function formatCurrency(n: number | string): string {
  return `$${Number(n).toFixed(2)}`;
}

export async function buildInvoicePdf(
  invoice: typeof invoicesTable.$inferSelect,
  contactName: string,
  contactEmail: string | null,
  companyName: string,
  logoUrl: string | null = null,
): Promise<Buffer> {
  let logoBuffer: Buffer | null = null;
  if (logoUrl) {
    try {
      const r = await fetch(logoUrl, { signal: AbortSignal.timeout(4000) });
      if (r.ok) logoBuffer = Buffer.from(await r.arrayBuffer());
    } catch { /* ignore logo fetch errors */ }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const lineItems = (invoice.lineItems ?? []) as { description: string; quantity: number; rate: number; amount: number }[];
    const statusColor: Record<string, string> = {
      draft: "#94a3b8", sent: "#3b82f6", paid: "#22c55e", overdue: "#ef4444",
    };
    const sColor = statusColor[invoice.status] ?? "#94a3b8";

    if (logoBuffer) {
      try { doc.image(logoBuffer, 50, 42, { height: 44 }); } catch { /* unsupported format */ }
      doc.fontSize(10).font("Helvetica").fillColor("#64748b").text(companyName, 50, 90);
    } else {
      doc.fontSize(24).font("Helvetica-Bold").fillColor("#1e293b").text(companyName, 50, 50);
      doc.fontSize(10).font("Helvetica").fillColor("#64748b").text("Invoice", 50, 82);
    }

    doc.fontSize(20).font("Helvetica-Bold").fillColor("#1e293b")
      .text(invoice.number, 350, 50, { align: "right", width: 200 });
    doc.fontSize(9).font("Helvetica-Bold").fillColor(sColor)
      .text(invoice.status.toUpperCase(), 350, 78, { align: "right", width: 200 });

    doc.moveTo(50, 100).lineTo(562, 100).strokeColor("#e2e8f0").lineWidth(1).stroke();

    doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8").text("BILL TO", 50, 115);
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#1e293b").text(contactName, 50, 128);
    if (contactEmail) doc.fontSize(9).font("Helvetica").fillColor("#64748b").text(contactEmail, 50, 143);

    const dateY = 115;
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8").text("ISSUE DATE", 380, dateY, { width: 180, align: "right" });
    doc.fontSize(9).font("Helvetica").fillColor("#1e293b")
      .text(new Date(invoice.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        380, dateY + 13, { width: 180, align: "right" });

    if (invoice.dueDate) {
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8").text("DUE DATE", 380, dateY + 30, { width: 180, align: "right" });
      doc.fontSize(9).font("Helvetica").fillColor("#1e293b")
        .text(new Date(invoice.dueDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
          380, dateY + 43, { width: 180, align: "right" });
    }

    if (invoice.paymentTerms) {
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8").text("TERMS", 380, dateY + 60, { width: 180, align: "right" });
      doc.fontSize(9).font("Helvetica").fillColor("#1e293b").text(invoice.paymentTerms, 380, dateY + 73, { width: 180, align: "right" });
    }

    const tableTop = 185;
    doc.rect(50, tableTop, 512, 20).fill("#f8fafc");
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#64748b");
    doc.text("DESCRIPTION", 58, tableTop + 6);
    doc.text("QTY",  340, tableTop + 6, { width: 50, align: "right" });
    doc.text("RATE", 395, tableTop + 6, { width: 70, align: "right" });
    doc.text("AMOUNT", 470, tableTop + 6, { width: 90, align: "right" });

    let y = tableTop + 26;
    lineItems.forEach((li, idx) => {
      if (idx % 2 === 1) doc.rect(50, y - 4, 512, 20).fill("#fafafa");
      doc.fontSize(9).font("Helvetica").fillColor("#1e293b");
      doc.text(li.description, 58, y, { width: 276 });
      doc.text(String(li.quantity),       340, y, { width: 50, align: "right" });
      doc.text(formatCurrency(li.rate),   395, y, { width: 70, align: "right" });
      doc.text(formatCurrency(li.amount), 470, y, { width: 90, align: "right" });
      y += 22;
    });

    y += 4;
    doc.moveTo(50, y).lineTo(562, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
    y += 10;

    const labW = 120, valW = 90, labX = 350;
    const addRow = (label: string, value: string, bold = false, color = "#1e293b") => {
      doc.fontSize(9)
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fillColor("#64748b").text(label, labX, y, { width: labW });
      doc.font(bold ? "Helvetica-Bold" : "Helvetica")
        .fillColor(color).text(value, labX + labW, y, { width: valW, align: "right" });
      y += 16;
    };
    addRow("Subtotal", formatCurrency(invoice.subtotal));
    if (Number(invoice.taxRate) > 0) addRow(`Tax (${invoice.taxRate}%)`, formatCurrency(invoice.taxAmount));
    y += 2;
    doc.moveTo(labX, y).lineTo(562, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
    y += 8;
    addRow("Total", formatCurrency(invoice.total), true, "#1e293b");

    if (invoice.notes) {
      y += 20;
      doc.moveTo(50, y).lineTo(562, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
      y += 12;
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8").text("NOTES", 50, y);
      y += 14;
      doc.fontSize(9).font("Helvetica").fillColor("#64748b").text(invoice.notes, 50, y, { width: 462 });
    }

    doc.end();
  });
}
