import express from 'express';
import cors from 'cors';
import { readFile } from 'fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import mongoose from 'mongoose';

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. KONEKSI KE MONGO DB ATLAS ---
// PENTING: Ganti "NAMA_DATABASE_ANDA" dengan nama database yang benar sebelum tanda "?"
const mongoURI = "mongodb://saintpaulsreview_db_user:RmtvDCOG9zF3HkTa@ac-zw4xosw-shard-00-00.rsx3ffs.mongodb.net:27017,ac-zw4xosw-shard-00-01.rsx3ffs.mongodb.net:27017,ac-zw4xosw-shard-00-02.rsx3ffs.mongodb.net:27017/akademik_db?replicaSet=atlas-1tr85e-shard-0&ssl=true&authSource=admin";

mongoose.connect(mongoURI)
  .then(() => console.log('Sukses Terhubung ke MongoDB Atlas Online!'))
  .catch((err) => console.error('Gagal koneksi ke MongoDB:', err));

// --- 2. DEFINISI SCHEMA MAHASISWA ---
const mahasiswaSchema = new mongoose.Schema({
  nama: String,
  nim: { type: String, unique: true, required: true },
  prodi: String,
  is_khs_locked: { type: Boolean, default: true }
}, { collection: 'mahasiswa' });

const Mahasiswa = mongoose.model('Mahasiswa', mahasiswaSchema);

// --- 3. FUNGSI HELPER ---
function roundTwo(value) { return Math.round((Number(value) + 1e-9) * 100) / 100; }
function calculateKhs(mataKuliah) {
  const rows = mataKuliah.map((item, index) => ({
    no: index + 1,
    ...item,
    sks_x_nilai: roundTwo(Number(item.sks) * Number(item.bobot_angka)),
  }));
  const total_sks = rows.reduce((total, item) => total + Number(item.sks), 0);
  const total_sks_x_nilai = roundTwo(rows.reduce((total, item) => total + item.sks_x_nilai, 0));
  const ips = total_sks ? roundTwo(total_sks_x_nilai / total_sks) : 0;
  return { rows, total_sks, total_sks_x_nilai, ips };
}
function drawText(page, text, x, y, font, size = 10, color = rgb(0, 0, 0)) {
  page.drawText(String(text), { x, y, size, font, color });
}
function formatDecimal(value) { return Number(value).toFixed(2); }


// ==========================================
// RUTE PENYAMBUT BROWSER
// ==========================================
app.get('/', (req, res) => {
  res.status(200).send('<h1>Server Backend KHS Aktif & Terlindungi! 🚀</h1>');
});


// ==========================================
// RUTE 1: CETAK PDF KHS (DENGAN GERBANG PENGUNCIAN)
// ==========================================
app.post('/api/cetak-khs', async (req, res) => {
  try {
    const khsData = req.body;
    const mahasiswaInput = khsData.mahasiswa || {};
    
    // PEMINDAIAN NIM EKSTRA AMAN: Paksa jadi string dan bersihkan spasi gaib
    const nimMentah = mahasiswaInput.nim;
    if (!nimMentah) {
      return res.status(400).json({ message: "NIM tidak disertakan dalam request." });
    }
    const nim = String(nimMentah).trim(); 

    console.log(`[CETAK KHS] Mengecek status gembok untuk NIM: "${nim}"`);
    
    // CEK DATABASE
    const dataMahasiswaDb = await Mahasiswa.findOne({ nim: nim }).maxTimeMS(5000);

    // DEBUGGING DATABASE
    console.log(`[DEBUG] Hasil pencarian dari MongoDB untuk NIM "${nim}":`, dataMahasiswaDb);

    if (!dataMahasiswaDb) {
      console.log(`[CETAK KHS] NIM "${nim}" tidak terdaftar di database.`);
      return res.status(404).json({ message: "Mahasiswa tidak terdaftar di sistem." });
    }

    // GERBANG KEAMANAN
    if (dataMahasiswaDb.is_khs_locked === true) {
      console.log(`[CETAK KHS] DITOLAK! NIM "${nim}" belum mengisi form.`);
      return res.status(403).json({ 
        success: false,
        message: "Akses ditolak! Anda harus mengisi form Planning Center terlebih dahulu." 
      });
    }

    console.log(`[CETAK KHS] Gembok Terbuka untuk ${nim}. Memulai render PDF...`);

    // --- PROSES RENDER PDF ---
    const [templateBytes, logoBytes, signatureBytes] = await Promise.all([
      fs.promises.readFile("Template_KHS_Kosong.pdf"),
      fs.promises.readFile("Logo_STT.png").catch(() => null),
      fs.promises.readFile("TTD.png").catch(() => null),
    ]);

    const pdfDoc = await PDFDocument.load(templateBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Embed gambar jika tersedia
    let logoImage, signatureImage;
    if (logoBytes) logoImage = await pdfDoc.embedPng(logoBytes);
    if (signatureBytes) signatureImage = await pdfDoc.embedPng(signatureBytes);

    const page = pdfDoc.getPages()[0] || pdfDoc.addPage();
    const { width, height } = page.getSize();
    
    const calculation = calculateKhs(khsData.mata_kuliah || []);
    const marginX = 50;
    const topY = height - 60;
    const lineColor = rgb(0.15, 0.25, 0.3);

    // --- KOP SURAT ---
    if (logoImage) {
      page.drawImage(logoImage, { x: marginX, y: topY - 45, width: 44, height: 44 });
    }

    let headerY = topY - 6;
    drawText(page, "SEKOLAH TINGGI TEOLOGI SAINT PAUL", marginX + 56, headerY, boldFont, 13);
    headerY -= 11;
    drawText(page, "Terdaftar di Departemen Agama RI - Ijin Dirjen Bimas Kristen", marginX + 56, headerY, font, 7.5);
    headerY -= 9;
    drawText(page, "Ijin Institusi : No.DJ/III/HK.05/217/2014 | Ijin Perpanjangan Prodi Teologi : No. 574 Tahun 2018", marginX + 56, headerY, font, 7.5);
    headerY -= 9;
    drawText(page, "Terakreditasi BAN-PT (Institusi : 92/SK/BAN-PT/Ak-PKP/PT/II/2022 | Prodi Teologi S1 : 837/SK/BAN-PT/Ak-PKP/S/II/2022)", marginX + 56, headerY, font, 7.5);
    headerY -= 9;
    drawText(page, "Kampus 1 : Jl. Purbasari No.3 - Cimahi (022) 665 0982", marginX + 56, headerY, font, 7.5);
    headerY -= 9;
    drawText(page, "Kampus 2 : Jl. Baranangsiang No.8 ITC Kosambi - Bandung (022) 422 2120", marginX + 56, headerY, font, 7.5);
    headerY -= 10;
    drawText(page, "Email : admin@sttsaintpaul.ac.id | Website : www.sttsaintpaul.ac.id", marginX + 56, headerY, font, 7.5);

    page.drawLine({ start: { x: marginX, y: headerY - 8 }, end: { x: width - marginX, y: headerY - 8 }, thickness: 1, color: lineColor });

    // --- DATA MAHASISWA DARI DATABASE ---
    let cursorY = headerY - 32;
    drawText(page, "KARTU HASIL STUDI (KHS)", marginX, cursorY, boldFont, 13);
    cursorY -= 25;
    drawText(page, `Nama  : ${dataMahasiswaDb.nama || mahasiswaInput.nama || '-'}`, marginX, cursorY, font, 10);
    drawText(page, `NIM   : ${dataMahasiswaDb.nim || '-'}`, marginX + 260, cursorY, font, 10);
    cursorY -= 16;
    drawText(page, `Prodi : ${dataMahasiswaDb.prodi || mahasiswaInput.prodi || '-'}`, marginX, cursorY, font, 10);

    // --- TABEL ---
    cursorY -= 30;
    const columns = [
      { label: "No", x: marginX, width: 30 },
      { label: "Kode", x: marginX + 35, width: 70 },
      { label: "Nama MK", x: marginX + 105, width: 225 },
      { label: "SKS", x: marginX + 335, width: 40 },
      { label: "Nilai", x: marginX + 385, width: 55 },
      { label: "SKS x Nilai", x: marginX + 450, width: 80 },
    ];

    page.drawRectangle({
      x: marginX - 4, y: cursorY - 6, width: width - marginX * 2, height: 18, color: rgb(0.86, 0.93, 0.98),
    });
    
    columns.forEach((column) => drawText(page, column.label, column.x, cursorY, boldFont, 9));
    cursorY -= 20;

    calculation.rows.forEach((item) => {
      drawText(page, item.no, columns[0].x, cursorY, font, 9);
      drawText(page, item.kode || '-', columns[1].x, cursorY, font, 9);
      drawText(page, item.nama_mk || '-', columns[2].x, cursorY, font, 9);
      drawText(page, item.sks || '0', columns[3].x, cursorY, font, 9);
      drawText(page, item.nilai_huruf || '-', columns[4].x, cursorY, font, 9);
      drawText(page, formatDecimal(item.sks_x_nilai), columns[5].x, cursorY, font, 9);
      cursorY -= 20;
    });

    page.drawLine({ start: { x: marginX, y: cursorY + 8 }, end: { x: width - marginX, y: cursorY + 8 }, thickness: 0.75, color: lineColor });

    drawText(page, `Total SKS: ${calculation.total_sks}`, marginX, cursorY - 8, boldFont, 10);
    drawText(page, `Total SKS x Nilai: ${formatDecimal(calculation.total_sks_x_nilai)}`, marginX + 140, cursorY - 8, boldFont, 10);
    drawText(page, `IPS: ${formatDecimal(calculation.ips)}`, marginX + 350, cursorY - 8, boldFont, 10);

    // --- TANDA TANGAN ---
    if (signatureImage) {
      const signatureWidth = 130;
      const signatureHeight = (signatureImage.height / signatureImage.width) * signatureWidth;
      const signatureX = width - marginX - signatureWidth;
      const signatureY = 100;

      const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
      const hariIni = new Date();
      const tanggalDinamis = `${hariIni.getDate()} ${namaBulan[hariIni.getMonth()]} ${hariIni.getFullYear()}`;

      drawText(page, `Bandung, ${tanggalDinamis}`, signatureX, signatureY + signatureHeight + 36, font, 10);
      drawText(page, "Kepala Program Studi Teologi", signatureX, signatureY + signatureHeight + 20, font, 10);
      page.drawImage(signatureImage, { x: signatureX, y: signatureY, width: signatureWidth, height: signatureHeight });
      drawText(page, "Fenius Gulo, M.Th.", signatureX, signatureY - 14, boldFont, 10);
      drawText(page, "NUPTK: 6436769670130313", signatureX, signatureY - 30, font, 9);
    }

    const outputBytes = await pdfDoc.save();
    
    console.log(`[CETAK KHS] Sukses merender PDF untuk ${nim}.`);
    res.contentType("application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=KHS_${nim}.pdf`);
    return res.send(Buffer.from(outputBytes));

  } catch (error) {
    console.error("Terjadi error pada proses PDF:", error);
    return res.status(500).json({ message: "Gagal memproses dokumen PDF." });
  }
});


// ==========================================
// RUTE 2: WEBHOOK PLANNING CENTER (MEMBUKA GEMBOK)
// ==========================================
app.post('/api/webhook/planning-center', async (req, res) => {
  try {
    const payload = req.body;
    console.log("[WEBHOOK] Menerima request masuk:", JSON.stringify(payload));

    let nimDariFormMentah = payload?.data?.attributes?.answers?.find(a => a.field_name === "NIM")?.value;

    if (!nimDariFormMentah) {
      console.log("[WEBHOOK] Payload ditolak: NIM tidak ditemukan.");
      return res.status(200).json({ success: false, message: "NIM tidak ditemukan dalam payload" });
    }

    // PEMINDAIAN NIM EKSTRA AMAN
    const nimDariForm = String(nimDariFormMentah).trim();

    const mahasiswa = await Mahasiswa.findOneAndUpdate(
      { nim: nimDariForm },
      { is_khs_locked: false },
      { returnDocument: 'after' }
    );

    if (!mahasiswa) {
      console.log(`[WEBHOOK] NIM "${nimDariForm}" tidak ditemukan di database.`);
      return res.status(200).json({ success: false, message: "NIM tidak terdaftar di DB" });
    }

    console.log(`[WEBHOOK] SUKSES! Gembok dibuka untuk NIM: ${nimDariForm}`);
    return res.status(200).json({ success: true, message: "Webhook berhasil, gembok KHS terbuka!" });

  } catch (error) {
    console.error("Error fatal pada proses Webhook:", error);
    return res.status(500).json({ message: "Internal Server Error pada Webhook" });
  }
});


// --- JALANKAN SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server KHS berjalan di port ${PORT}`);
});