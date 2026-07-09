import express from 'express';
import cors from 'cors';
import { readFile } from 'fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import mongoose from 'mongoose'; // <-- PASTIKAN BARIS INI ADA DI ATAS!

const app = express();
// ... sisa kode app.use dan mongoose.connect Anda ke bawah ...

app.use(cors());
app.use(express.json());

// --- 2. KONEKSI KE MONGO DB ATLAS ---
// Pastikan ganti <db_password> dengan password user 'saintpaulsreview_db_user' Anda!
// GANTI DENGAN FORMAT LEGACY INI
const mongoURI = "mongodb://saintpaulsreview_db_user:RmtvDCOG9zF3HkTa@ac-zw4xosw-shard-00-00.rsx3ffs.mongodb.net:27017,ac-zw4xosw-shard-00-01.rsx3ffs.mongodb.net:27017,ac-zw4xosw-shard-00-02.rsx3ffs.mongodb.net:27017/?replicaSet=atlas-1tr85e-shard-0&ssl=true&authSource=admin";

mongoose.connect(mongoURI)
  .then(() => console.log('Sukses Terhubung ke MongoDB Atlas Online!'))
  .catch((err) => console.error('Gagal koneksi ke MongoDB:', err));

// --- 3. DEFINISI SCHEMA MAHASISWA ---
const mahasiswaSchema = new mongoose.Schema({
  nama: String,
  nim: { type: String, unique: true, required: true },
  prodi: String,
  is_khs_locked: { type: Boolean, default: true }
});

const Mahasiswa = mongoose.model('Mahasiswa', mahasiswaSchema);

// --- FUNGSI HELPER ---
function roundTwo(value) {
  return Math.round((Number(value) + 1e-9) * 100) / 100;
}

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

function formatDecimal(value) {
  return Number(value).toFixed(2);
}

// --- ENDPOINT API SERVER ---
app.post('/api/webhook/planning-center', async (req, res) => {
  try {
    // 1. Mengambil data JSON dinamis yang dikirim dari tombol frontend
    const khsData = req.body;
    
    // Pastikan objek mahasiswa tidak undefined untuk menghindari error
    const mahasiswa = khsData.mahasiswa || {};

    // 2. Membaca template dan gambar
    const [templateBytes, logoBytes, signatureBytes] = await Promise.all([
      readFile("Template_KHS_Kosong.pdf"),
      readFile("Logo_STT.png"),
      readFile("TTD.png"),
    ]);

    const pdfDoc = await PDFDocument.load(templateBytes);
    const logoImage = await pdfDoc.embedPng(logoBytes);
    const signatureImage = await pdfDoc.embedPng(signatureBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const page = pdfDoc.getPages()[0] || pdfDoc.addPage();
    const { width, height } = page.getSize();
    
    const calculation = calculateKhs(khsData.mata_kuliah || []);

    const marginX = 50;
    const topY = height - 60;
    const lineColor = rgb(0.15, 0.25, 0.3);

    // --- LOGO ---
    page.drawImage(logoImage, {
      x: marginX,
      y: topY - 45,
      width: 44,
      height: 44,
    });

    // --- KOP SURAT ---
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

    page.drawLine({
      start: { x: marginX, y: headerY - 8 },
      end: { x: width - marginX, y: headerY - 8 },
      thickness: 1,
      color: lineColor,
    });

    // --- DATA MAHASISWA ---
    let cursorY = headerY - 32;
    drawText(page, "KARTU HASIL STUDI (KHS)", marginX, cursorY, boldFont, 13);
    cursorY -= 25;
    drawText(page, `Nama  : ${mahasiswa.nama || '-'}`, marginX, cursorY, font, 10);
    drawText(page, `NIM   : ${mahasiswa.nim || '-'}`, marginX + 260, cursorY, font, 10);
    cursorY -= 16;
    drawText(page, `Prodi : ${mahasiswa.prodi || '-'}`, marginX, cursorY, font, 10);

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
      x: marginX - 4,
      y: cursorY - 6,
      width: width - marginX * 2,
      height: 18,
      color: rgb(0.86, 0.93, 0.98),
    });
    columns.forEach((column) => drawText(page, column.label, column.x, cursorY, boldFont, 9));

    cursorY -= 20;
    calculation.rows.forEach((item) => {
      drawText(page, item.no, columns[0].x, cursorY, font, 9);
      drawText(page, item.kode, columns[1].x, cursorY, font, 9);
      drawText(page, item.nama_mk, columns[2].x, cursorY, font, 9);
      drawText(page, item.sks, columns[3].x, cursorY, font, 9);
      drawText(page, item.nilai_huruf, columns[4].x, cursorY, font, 9);
      drawText(page, formatDecimal(item.sks_x_nilai), columns[5].x, cursorY, font, 9);
      cursorY -= 20;
    });

    page.drawLine({
      start: { x: marginX, y: cursorY + 8 },
      end: { x: width - marginX, y: cursorY + 8 },
      thickness: 0.75,
      color: lineColor,
    });

    drawText(page, `Total SKS: ${calculation.total_sks}`, marginX, cursorY - 8, boldFont, 10);
    drawText(page, `Total SKS x Nilai: ${formatDecimal(calculation.total_sks_x_nilai)}`, marginX + 140, cursorY - 8, boldFont, 10);
    drawText(page, `IPS: ${formatDecimal(calculation.ips)}`, marginX + 350, cursorY - 8, boldFont, 10);

    // --- TANDA TANGAN (DINAMIS) ---
    const signatureWidth = 130;
    const signatureHeight = (signatureImage.height / signatureImage.width) * signatureWidth;
    const signatureX = width - marginX - signatureWidth;
    const signatureY = 100;

    // Membuat tanggal dinamis format Indonesia (Contoh: 9 Juli 2026)
    const namaBulan = [
      "Januari", "Februari", "Maret", "April", "Mei", "Juni",
      "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    ];
    const hariIni = new Date();
    const tanggalDinamis = `${hariIni.getDate()} ${namaBulan[hariIni.getMonth()]} ${hariIni.getFullYear()}`;

    // Menggunakan variabel tanggalDinamis
    drawText(page, `Bandung, ${tanggalDinamis}`, signatureX, signatureY + signatureHeight + 36, font, 10);
    drawText(page, "Kepala Program Studi Teologi", signatureX, signatureY + signatureHeight + 20, font, 10);
    page.drawImage(signatureImage, {
      x: signatureX,
      y: signatureY,
      width: signatureWidth,
      height: signatureHeight,
    });
    drawText(page, "Fenius Gulo, M.Th.", signatureX, signatureY - 14, boldFont, 10);
    drawText(page, "NUPTK: 6436769670130313", signatureX, signatureY - 30, font, 9);

    // 3. Simpan dan kirim ke Frontend sebagai Stream/Download
    const outputBytes = await pdfDoc.save();
    
    res.contentType("application/pdf");
    // Menggunakan NIM mahasiswa sebagai nama file jika tersedia
    res.setHeader("Content-Disposition", `attachment; filename=KHS_${mahasiswa.nim || 'Mahasiswa'}.pdf`);
    res.send(Buffer.from(outputBytes));

  } catch (error) {
    console.error("Terjadi error pada proses PDF:", error);
    res.status(500).json({ message: "Gagal memproses dokumen PDF." });
  }
});

// Menggunakan port dinamis dari hosting, jika tidak ada baru gunakan 3000
const PORT = process.env.PORT || 3000;

// ==========================================
// RUTE 1: UNTUK CETAK PDF (MENGGUNAKAN TEMPLATE)
// ==========================================
app.post('/api/cetak-khs', async (req, res) => {
  try {
    console.log("Memulai proses cetak PDF...");
    // ... kode pembacaan Template_KHS_Kosong.pdf Anda ada di sini ...
  } catch (error) {
    console.error("Terjadi error pada proses PDF:", error); // <-- Ini yang memicu log Anda tadi!
    return res.status(500).json({ message: "Gagal cetak PDF" });
  }
});

// ==========================================
// RUTE 2: UNTUK WEBHOOK PLANNING CENTER (HANYA UPDATE MONGODB)
// ==========================================
app.post('/api/webhook/planning-center', async (req, res) => {
  try {
    const payload = req.body;
    console.log("Menerima data Webhook dari Planning Center:", JSON.stringify(payload));

    // Logika mengambil NIM dari payload form
    let nimDariForm = payload?.data?.attributes?.answers?.find(a => a.field_name === "NIM")?.value;

    if (!nimDariForm) {
      return res.status(200).json({ success: false, message: "NIM tidak ditemukan" });
    }

    // UPDATE DATABASE (Tanpa menyentuh file PDF sama sekali!)
    const mahasiswa = await Mahasiswa.findOneAndUpdate(
      { nim: nimDariForm },
      { is_khs_locked: false },
      { returnDocument: 'after' }
    );

    if (!mahasiswa) {
      return res.status(200).json({ success: false, message: "NIM tidak terdaftar di DB" });
    }

    return res.status(200).json({ success: true, message: "Gembok KHS terbuka!" });

  } catch (error) {
    console.error("Error fatal pada proses Webhook:", error);
    return res.status(500).json({ message: "Internal Server Error pada Webhook" });
  }
});

app.listen(PORT, () => {
  console.log(`Server KHS berjalan di port ${PORT}`);
});

// Menyalakan server agar terus mendengarkan request
//app.listen(3000, () => {
  //console.log('Server KHS berjalan di port 3000');
//});