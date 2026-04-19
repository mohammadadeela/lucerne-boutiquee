import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { setupAuth } from "./auth";
import passport from "passport";
import { z } from "zod";
import multer from "multer";
import path from "path";
import { randomUUID, randomInt } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { uploadToCloudinary, deleteFromCloudinary, uploadVideoToCloudinary } from "./cloudinary";
import { sendPasswordResetCode, sendSignupVerificationCode, sendOrderNotification, sendOrderConfirmationToCustomer } from "./email";
import ExcelJS from "exceljs";
import rateLimit from "express-rate-limit";

// Rate limiters for auth endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  skipSuccessfulRequests: true,
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many verification attempts. Please try again in an hour." },
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset requests. Please try again in an hour." },
});

async function getShippingRates(): Promise<Record<string, number>> {
  try {
    const settings = await storage.getSiteSettings();
    const setting = settings.find((s) => s.key === "shipping_zones");
    if (setting?.value) {
      const zones = JSON.parse(setting.value) as { id: string; price: number }[];
      const rates: Record<string, number> = {};
      for (const z of zones) {
        if (z.id && typeof z.price === "number") rates[z.id] = z.price;
      }
      return rates;
    }
  } catch {}
  return { westBank: 20, jerusalem: 30, interior: 75 };
}
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { initializeLahzaTransaction, verifyLahzaTransaction } from "./lahza";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|avif)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(xlsx|xls)$/i;
    const allowedMime = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ];
    if (allowed.test(path.extname(file.originalname)) || allowedMime.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls) are allowed"));
    }
  },
});

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(mp4|webm|mov|avi|mkv)$/i;
    const allowedMime = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska"];
    if (allowed.test(path.extname(file.originalname)) || allowedMime.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only video files (mp4, webm, mov) are allowed"));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const { hashPassword } = setupAuth(app);

  app.post("/api/upload", (req, res, next) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  }, (req, res, next) => {
    upload.array("images", 10)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ message: "File too large. Max 10MB per image." });
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
          return res.status(400).json({ message: "Too many files. Max 10 images." });
        }
        return res.status(400).json({ message: err.message });
      }
      if (err) {
        return res.status(400).json({ message: err.message || "Upload failed" });
      }
      next();
    });
  }, async (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }
    try {
      const urls = await Promise.all(
        files.map(f => uploadToCloudinary(f.buffer, f.originalname))
      );
      res.json({ urls });
    } catch (err: any) {
      console.error("Cloudinary upload error:", err);
      res.status(500).json({ message: "Image upload failed. Please try again." });
    }
  });

  app.delete("/api/upload", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "url is required" });
    }
    if (!url.includes("cloudinary.com")) {
      return res.status(400).json({ message: "Not a Cloudinary URL" });
    }
    await deleteFromCloudinary(url);
    res.json({ success: true });
  });

  app.post("/api/upload-video", (req, res, next) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  }, (req, res, next) => {
    uploadVideo.single("video")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ message: "File too large. Max 100MB per video." });
        }
        return res.status(400).json({ message: err.message });
      }
      if (err) {
        return res.status(400).json({ message: err.message || "Upload failed" });
      }
      next();
    });
  }, async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No video uploaded" });
    try {
      const url = await uploadVideoToCloudinary(file.buffer, file.originalname);
      res.json({ url });
    } catch (err: any) {
      console.error("Cloudinary video upload error:", err);
      res.status(500).json({ message: "Video upload failed. Please try again." });
    }
  });

  // Seed DB with mock data if needed
  async function seed() {
    const categories = await storage.getCategories();
    if (categories.length === 0) {
      const dressesCat = await storage.createCategory({ name: "Dresses", nameAr: "فساتين", slug: "dresses" });
      const topsCat = await storage.createCategory({ name: "Tops & Blouses", nameAr: "بلوزات وقمصان", slug: "tops" });
      const pantsCat = await storage.createCategory({ name: "Pants & Skirts", nameAr: "بناطيل وتنانير", slug: "pants-skirts" });
      const shoesCat = await storage.createCategory({ name: "Shoes", nameAr: "شوزات", slug: "shoes" });
      const bagsCat = await storage.createCategory({ name: "Bags", nameAr: "حقائب", slug: "bags" });
      const accessoriesCat = await storage.createCategory({ name: "Accessories", nameAr: "إكسسوارات", slug: "accessories" });
    }

    const adminUser = await storage.getUserByEmail("admin@lucerne.com");
    if (!adminUser) {
      await storage.createUser({
        email: "admin@lucerne.com",
        password: await hashPassword("admin123"),
        role: "admin",
        fullName: "Store Admin",
        isVerified: true,
      });
    }
  }
  
  // Call seed on start (fire and forget)
  seed().catch(console.error);

  // Signup email verification — codes stored in memory (15-min TTL)
  const signupCodes = new Map<string, { code: string; expiresAt: number }>();

  // --- Auth Routes ---
  app.post(api.auth.register.path, async (req, res) => {
    try {
      const input = api.auth.register.input.parse(req.body);
      const existingUser = await storage.getUserByEmail(input.email);
      if (existingUser) {
        if (existingUser.isBlocked) return res.status(403).json({ message: "account_blocked" });
        return res.status(400).json({ message: "Email already exists" });
      }

      // Verify that the signup code was validated before allowing registration
      const signupCode = req.body.signupCode as string | undefined;
      if (signupCode) {
        const entry = signupCodes.get(input.email);
        if (!entry || entry.code !== signupCode || Date.now() > entry.expiresAt) {
          return res.status(400).json({ message: "invalid_code" });
        }
        signupCodes.delete(input.email);
      }

      const hashedPassword = await hashPassword(input.password);
      const newUser = await storage.createUser({
        ...input,
        password: hashedPassword,
        role: "customer",
        isVerified: true,
      });

      req.login(newUser, (loginErr) => {
        if (loginErr) return res.status(500).json({ message: "Login failed" });
        const { password, verificationCode: _vc, ...safe } = newUser;
        res.json(safe);
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.post(api.auth.login.path, loginLimiter, (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return res.status(500).json({ message: "Internal server error" });
      if (!user) {
        const code = info?.message;
        if (code === "account_blocked") return res.status(403).json({ message: "account_blocked" });
        if (code === "email_not_found") return res.status(401).json({ message: "email_not_found" });
        if (code === "invalid_password") return res.status(401).json({ message: "invalid_password" });
        return res.status(401).json({ message: "invalid_credentials" });
      }

      req.login(user, (loginErr) => {
        if (loginErr) return res.status(500).json({ message: "Login failed" });
        const { password, verificationCode: _vc, ...userWithoutSensitive } = user;
        res.json(userWithoutSensitive);
      });
    })(req, res, next);
  });

  app.get(api.auth.me.path, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const sessionUser = req.user as any;
    const freshUser = await storage.getUser(sessionUser.id);
    if (!freshUser || freshUser.isBlocked) {
      req.logout((err) => {
        if (err) console.error("Logout error on blocked user:", err);
      });
      return res.status(403).json({ message: "account_blocked" });
    }
    const { password, verificationCode: _vc, ...userWithoutSensitive } = freshUser;
    res.json(userWithoutSensitive);
  });

  app.post(api.auth.logout.path, (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      res.json({ message: "Logged out" });
    });
  });


  // Firebase social login (Google / Facebook)
  app.post("/api/auth/firebase-login", async (req, res) => {
    try {
      const { idToken, provider, displayName } = req.body;
      if (!idToken) return res.status(400).json({ message: "Missing idToken" });

      const parts = idToken.split(".");
      if (parts.length !== 3) return res.status(401).json({ message: "Invalid Firebase token" });
      let payload: any;
      try {
        payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      } catch {
        return res.status(401).json({ message: "Invalid Firebase token" });
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (!payload.exp || payload.exp < nowSec) {
        return res.status(401).json({ message: "Firebase token expired" });
      }
      if (!payload.iat || payload.iat > nowSec + 60) {
        return res.status(401).json({ message: "Invalid Firebase token" });
      }
      const projectId = process.env.FIREBASE_PROJECT_ID || "lucerne-69027";
      if (payload.aud !== projectId) {
        return res.status(401).json({ message: "Invalid Firebase token audience" });
      }
      if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
        return res.status(401).json({ message: "Invalid Firebase token issuer" });
      }
      if (!payload.sub || typeof payload.sub !== "string" || payload.sub.length === 0) {
        return res.status(401).json({ message: "Invalid Firebase token subject" });
      }
      if (payload.auth_time && payload.auth_time > nowSec + 60) {
        return res.status(401).json({ message: "Invalid Firebase token auth time" });
      }

      const email: string = payload.email || "";
      if (!email) return res.status(400).json({ message: "No email in Firebase token" });

      let user = await storage.getUserByEmail(email);
      if (!user) {
        user = await storage.createUser({
          email,
          password: randomUUID(),
          fullName: displayName || payload.name || email.split("@")[0],
          role: "customer",
          isVerified: true,
        });
      } else if (!user.isVerified) {
        await storage.updateUser(user.id, { isVerified: true });
        user = (await storage.getUser(user.id))!;
      }

      if (user.isBlocked) return res.status(403).json({ message: "account_blocked" });

      req.login(user, (loginErr) => {
        if (loginErr) return res.status(500).json({ message: "Login failed" });
        const { password, verificationCode: _vc, ...safe } = user!;
        res.json(safe);
      });
    } catch (err: any) {
      console.error("Firebase login error:", err);
      res.status(500).json({ message: err.message || "Login failed" });
    }
  });

  app.post("/api/auth/send-signup-code", otpLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email required" });
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        if (existing.isBlocked) return res.status(403).json({ message: "account_blocked" });
        return res.status(400).json({ message: "email_taken" });
      }

      const code = String(randomInt(100000, 999999));
      signupCodes.set(email, { code, expiresAt: Date.now() + 15 * 60 * 1000 });
      sendSignupVerificationCode(email, code).catch(console.error);
      res.json({ sent: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  app.post("/api/auth/verify-signup-code", otpLimiter, async (req, res) => {
    try {
      const { email, code } = req.body;
      if (!email || !code) return res.status(400).json({ message: "Missing fields" });
      const entry = signupCodes.get(email);
      if (!entry || entry.code !== code || Date.now() > entry.expiresAt) {
        return res.status(400).json({ message: "invalid_code" });
      }
      res.json({ valid: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  // Forgot password — reset codes stored in memory (15-min TTL)
  const resetCodes = new Map<string, { code: string; expiresAt: number }>();

  app.post("/api/auth/forgot-password", passwordResetLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email required" });
      const user = await storage.getUserByEmail(email);
      if (!user) return res.json({ sent: false, reason: "email_not_found" });

      const code = String(randomInt(100000, 999999));
      resetCodes.set(email, { code, expiresAt: Date.now() + 15 * 60 * 1000 });
      sendPasswordResetCode(email, code).catch(console.error);
      res.json({ sent: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  // Verify reset code only (no password change yet)
  app.post("/api/auth/verify-reset-code", otpLimiter, async (req, res) => {
    try {
      const { email, code } = req.body;
      if (!email || !code) return res.status(400).json({ message: "Missing fields" });
      const entry = resetCodes.get(email);
      if (!entry || entry.code !== code || Date.now() > entry.expiresAt) {
        return res.status(400).json({ message: "invalid_code" });
      }
      res.json({ valid: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  app.post("/api/auth/reset-password", passwordResetLimiter, async (req, res) => {
    try {
      const { email, code, newPassword } = req.body;
      if (!email || !code || !newPassword) return res.status(400).json({ message: "Missing fields" });
      if (newPassword.length < 6) return res.status(400).json({ message: "Password too short" });

      const entry = resetCodes.get(email);
      if (!entry || entry.code !== code || Date.now() > entry.expiresAt) {
        return res.status(400).json({ message: "invalid_code" });
      }

      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(404).json({ message: "User not found" });

      const hashed = await hashPassword(newPassword);
      await storage.updateUser(user.id, { password: hashed });
      resetCodes.delete(email);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  // --- Product Routes ---
  app.get("/api/products/best-sellers", async (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || "8")), 20);
    const items = await storage.getBestSellers(limit);
    res.json(items);
  });

  // Track product events (fire-and-forget, always 200)
  app.post("/api/events/product", async (req, res) => {
    try {
      const { productId, eventType, sessionId, userId } = req.body;
      if (!productId || !eventType) return res.json({ ok: true });
      if (!["view", "cart_add"].includes(eventType)) return res.json({ ok: true });
      await storage.recordProductEvent({
        productId: Number(productId),
        eventType,
        sessionId: sessionId || null,
        userId: userId ? Number(userId) : null,
      });
    } catch {}
    res.json({ ok: true });
  });

  // Get smart recommendations for a product
  app.get("/api/products/:id/recommendations", async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const ids = await storage.getProductRecommendations(productId);
      res.json(ids);
    } catch (e) {
      res.json([]);
    }
  });

  app.get(api.products.list.path, async (req, res) => {
    const products = await storage.getProducts();
    res.json(products);
  });

  app.get(api.products.get.path, async (req, res) => {
    const product = await storage.getProduct(Number(req.params.id));
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  });

  app.post(api.products.create.path, async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const input = api.products.create.input.parse(req.body);
      const product = await storage.createProduct(input);
      res.status(201).json(product);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.put(api.products.update.path, async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const input = api.products.update.input.parse(req.body);
      const product = await storage.updateProduct(Number(req.params.id), input);
      if (!product) return res.status(404).json({ message: "Not found" });
      res.json(product);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.delete(api.products.delete.path, async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const success = await storage.deleteProduct(Number(req.params.id));
    if (!success) return res.status(404).json({ message: "Not found" });
    res.status(204).send();
  });

  app.patch("/api/products/bulk-flags", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { ids, updates } = req.body as {
      ids: number[];
      updates: { isBestSeller?: boolean; isNewArrival?: boolean; isFeatured?: boolean };
    };
    if (!Array.isArray(ids) || ids.length === 0 || typeof updates !== "object") {
      return res.status(400).json({ message: "Invalid payload" });
    }
    await Promise.all(ids.map(id => storage.updateProduct(id, updates as any)));
    res.json({ updated: ids.length });
  });

  // Expire new arrivals older than N days & persist the period setting
  app.patch("/api/admin/products/expire-new-arrivals", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const daysNum = Math.max(1, Math.min(365, Number(req.body.days ?? 14)));
    await storage.setSiteSetting("new_arrivals_days", String(daysNum));
    const result = await db.execute(sql`
      UPDATE products
      SET is_new_arrival = false
      WHERE is_new_arrival = true
        AND created_at < NOW() - (${daysNum} * INTERVAL '1 day')
    `);
    res.json({ updated: result.rowCount ?? 0, days: daysNum });
  });

  // --- Bulk Product Import (Excel) ---
  app.get("/api/admin/products/bulk-template", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const headers = [
      "name", "name_ar", "description", "price", "cost_price", "discount_price",
      "category_id", "barcode", "brand", "sizes", "stock_quantity",
      "colors", "color_codes",
      "is_featured", "is_new_arrival", "is_best_seller", "main_image_url",
    ];
    const example = [
      "Summer Dress", "فستان صيفي", "Product description", 150, 80, 120,
      1, "12345678", "Lucerne", "S,M,L", 10,
      "Black,White", "#000000,#FFFFFF",
      "no", "yes", "no", "https://res.cloudinary.com/YOUR_URL_HERE",
    ];
    const hint = [
      "اسم المنتج بالإنجليزي (مطلوب)", "اسم المنتج بالعربي (اختياري)", "وصف", "السعر (مطلوب)", "سعر التكلفة", "سعر الخصم",
      "رقم الفئة: 1=فساتين 4=شوزات 10=ملابس 11=بناطيل", "الباركود", "الماركة",
      "المقاسات مفصولة بفاصلة: S,M,L أو 36,37,38", "الكمية الإجمالية",
      "أسماء الألوان مفصولة بفاصلة: Black,White,Red", "كودات الألوان HEX مفصولة بفاصلة: #000000,#FFFFFF,#FF0000",
      "yes / no", "yes / no", "yes / no", "رابط صورة كلاودينري (مطلوب)",
    ];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Products");
    ws.addRow(headers);
    ws.addRow(hint);
    ws.addRow(example);
    ws.columns = headers.map(() => ({ width: 28 }));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="lucerne-products-template.xlsx"');
    res.send(buf);
  });

  app.post("/api/admin/products/bulk-import", uploadExcel.single("file"), async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer);
      const ws = wb.worksheets[0];
      const rows: Record<string, any>[] = [];
      const headerRow = (ws.getRow(1).values as any[]).slice(1);
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const obj: Record<string, any> = {};
        const values = (row.values as any[]).slice(1);
        headerRow.forEach((key: string, i: number) => { obj[key] = values[i] ?? ""; });
        rows.push(obj);
      });
      const results: { created: number; errors: string[] } = { created: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        try {
          const name = String(row.name ?? "").trim();
          if (!name || name.startsWith("اسم المنتج")) continue; // skip hint row
          const price = parseFloat(String(row.price ?? "0").replace(/[^\d.]/g, ""));
          if (isNaN(price) || price <= 0) { results.errors.push(`صف ${rowNum}: السعر غير صحيح`); continue; }
          const mainImage = String(row.main_image_url ?? "").trim();
          if (!mainImage || mainImage.startsWith("رابط") || mainImage.includes("YOUR_URL")) {
            results.errors.push(`صف ${rowNum}: رابط الصورة مطلوب`); continue;
          }
          const categoryId = parseInt(String(row.category_id ?? "1")) || 1;
          const stockQty = parseInt(String(row.stock_quantity ?? "0")) || 0;
          const sizesRaw = String(row.sizes ?? "").trim();
          const sizesArr = sizesRaw ? sizesRaw.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
          const colorsRaw = String(row.colors ?? "").trim();
          const colorCodesRaw = String(row.color_codes ?? "").trim();
          const colorsArr = colorsRaw ? colorsRaw.split(",").map((c: string) => c.trim()).filter(Boolean) : [];
          const colorCodesArr = colorCodesRaw ? colorCodesRaw.split(",").map((c: string) => c.trim()).filter(Boolean) : [];

          let sizeInventory: Record<string, number> = {};
          let colorVariants: any[] = [];

          if (colorsArr.length > 0) {
            // Build per-color variants with their own sizeInventory
            const perColor = colorsArr.length > 0 ? Math.floor(stockQty / colorsArr.length) : stockQty;
            const perColorPerSize = sizesArr.length > 0 ? Math.floor(perColor / sizesArr.length) : perColor;
            colorVariants = colorsArr.map((colorName: string, idx: number) => {
              const colorCode = colorCodesArr[idx] || "#000000";
              const sizeInv: Record<string, number> = {};
              sizesArr.forEach((s: string) => { sizeInv[s] = perColorPerSize; });
              return { name: colorName, sizes: sizesArr, sizeInventory: sizeInv, colorCode, mainImage, images: [] };
            });
            // Merge sizeInventory across all color variants
            colorVariants.forEach((cv: any) => {
              Object.entries(cv.sizeInventory as Record<string, number>).forEach(([sz, qty]) => {
                sizeInventory[sz] = (sizeInventory[sz] || 0) + qty;
              });
            });
          } else if (sizesArr.length > 0) {
            const perSize = Math.floor(stockQty / sizesArr.length);
            sizesArr.forEach((s: string) => { sizeInventory[s] = perSize; });
          }

          const yesNo = (v: any) => ["yes", "true", "1", "نعم"].includes(String(v ?? "").toLowerCase().trim());
          const nameAr = String(row.name_ar ?? "").trim();
          const product: any = {
            name,
            nameAr: nameAr || null,
            description: String(row.description ?? "").trim() || name,
            price: price.toFixed(2),
            costPrice: row.cost_price ? parseFloat(String(row.cost_price)).toFixed(2) : null,
            discountPrice: row.discount_price ? parseFloat(String(row.discount_price)).toFixed(2) : null,
            mainImage,
            images: [],
            categoryId,
            subcategoryId: null,
            barcode: String(row.barcode ?? "").trim(),
            brand: String(row.brand ?? "").trim(),
            sizes: sizesArr,
            colors: colorsArr,
            sizeInventory,
            colorVariants,
            stockQuantity: stockQty,
            isFeatured: yesNo(row.is_featured),
            isNewArrival: yesNo(row.is_new_arrival),
            isBestSeller: yesNo(row.is_best_seller),
          };
          await storage.createProduct(product);
          results.created++;
        } catch (err: any) {
          results.errors.push(`صف ${rowNum}: ${err.message}`);
        }
      }
      res.json(results);
    } catch (err: any) {
      res.status(400).json({ message: "فشل قراءة الملف: " + err.message });
    }
  });

  // --- Categories ---
  app.get(api.categories.list.path, async (req, res) => {
    const categories = await storage.getCategories();
    res.json(categories);
  });

  app.post("/api/categories", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { name, nameAr, slug, image, showOnHome } = req.body;
      if (!name || !slug) return res.status(400).json({ message: "name and slug are required" });
      const created = await storage.createCategory({ name, nameAr: nameAr || null, slug, image: image || null, showOnHome: showOnHome ?? false });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Create failed" });
    }
  });

  app.patch("/api/categories/:id", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const updated = await storage.updateCategory(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ message: "Update failed" });
    }
  });

  app.delete("/api/categories/:id", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const success = await storage.deleteCategory(Number(req.params.id));
      if (!success) return res.status(404).json({ message: "Not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Delete failed" });
    }
  });

  // --- Subcategories ---
  app.get("/api/subcategories", async (req, res) => {
    const subs = await storage.getSubcategories();
    res.json(subs);
  });

  app.get("/api/subcategories/category/:categoryId", async (req, res) => {
    const subs = await storage.getSubcategoriesByCategory(Number(req.params.categoryId));
    res.json(subs);
  });

  app.post("/api/subcategories", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const sub = await storage.createSubcategory(req.body);
      res.status(201).json(sub);
    } catch (err) {
      res.status(400).json({ message: "Create failed" });
    }
  });

  app.patch("/api/subcategories/:id", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const updated = await storage.updateSubcategory(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ message: "Update failed" });
    }
  });

  app.delete("/api/subcategories/:id", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const success = await storage.deleteSubcategory(Number(req.params.id));
    if (!success) return res.status(404).json({ message: "Not found" });
    res.status(204).send();
  });

  // --- Orders ---
  app.get(api.orders.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    
    if (user.role === 'admin') {
      const orders = await storage.getOrders();
      res.json(orders);
    } else {
      const orders = await storage.getUserOrders(user.id);
      res.json(orders);
    }
  });

  app.get(api.orders.get.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const orderData = await storage.getOrder(Number(req.params.id));
    
    if (!orderData) return res.status(404).json({ message: "Not found" });
    
    const user = req.user as any;
    if (user.role !== 'admin' && orderData.order.userId !== user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    res.json(orderData);
  });

  function checkStockForItems(items: Array<{productId: number; quantity: number; size?: string | null; color?: string | null}>, products: Map<number, any>): { productId: number; name: string; color?: string | null; size?: string | null; reason: string; available?: number; requested?: number }[] {
    const outOfStock: { productId: number; name: string; color?: string | null; size?: string | null; reason: string; available?: number; requested?: number }[] = [];
    for (const item of items) {
      const product = products.get(item.productId);
      if (!product) {
        outOfStock.push({ productId: item.productId, name: `Product #${item.productId}`, color: item.color, size: item.size, reason: "not_found" });
        continue;
      }
      const colorVariants = ((product as any).colorVariants || []) as Array<{name: string; sizes: string[]; sizeInventory: Record<string, number>}>;
      const itemColor = item.color;
      const itemSize = item.size;

      if (colorVariants.length > 0) {
        if (!itemColor) {
          outOfStock.push({ productId: item.productId, name: product.name, color: itemColor, size: itemSize, reason: "color_required" });
          continue;
        }
        const variant = colorVariants.find(v => v.name === itemColor);
        if (!variant) {
          outOfStock.push({ productId: item.productId, name: product.name, color: itemColor, size: itemSize, reason: "color_unavailable" });
          continue;
        }
        const vInv = variant.sizeInventory || {};
        const hasSizes = Object.keys(vInv).length > 0;
        if (hasSizes) {
          if (!itemSize) {
            outOfStock.push({ productId: item.productId, name: product.name, color: itemColor, size: itemSize, reason: "size_required" });
            continue;
          }
          if (vInv[itemSize] === undefined) {
            outOfStock.push({ productId: item.productId, name: product.name, color: itemColor, size: itemSize, reason: "size_unavailable" });
            continue;
          }
          const avail = vInv[itemSize];
          if (avail < item.quantity) {
            outOfStock.push({
              productId: item.productId, name: product.name, color: itemColor, size: itemSize,
              reason: avail === 0 ? "sold_out" : "insufficient_stock",
              available: avail, requested: item.quantity
            });
            continue;
          }
        } else {
          const variantTotal = Object.values(vInv).reduce((s, q) => s + q, 0);
          if (variantTotal < item.quantity) {
            outOfStock.push({
              productId: item.productId, name: product.name, color: itemColor, size: itemSize,
              reason: variantTotal === 0 ? "sold_out" : "insufficient_stock",
              available: variantTotal, requested: item.quantity
            });
            continue;
          }
        }
      } else {
        const inv = (product.sizeInventory as Record<string, number>) || {};
        if (itemSize && Object.keys(inv).length > 0) {
          if (inv[itemSize] === undefined) {
            outOfStock.push({ productId: item.productId, name: product.name, color: itemColor, size: itemSize, reason: "size_unavailable" });
            continue;
          }
          const avail = inv[itemSize];
          if (avail < item.quantity) {
            outOfStock.push({
              productId: item.productId, name: product.name, color: itemColor, size: itemSize,
              reason: avail === 0 ? "sold_out" : "insufficient_stock",
              available: avail, requested: item.quantity
            });
            continue;
          }
        } else {
          const avail = product.stockQuantity;
          if (avail < item.quantity) {
            outOfStock.push({
              productId: item.productId, name: product.name, color: itemColor, size: itemSize,
              reason: avail === 0 ? "sold_out" : "insufficient_stock",
              available: avail, requested: item.quantity
            });
            continue;
          }
        }
      }
    }
    return outOfStock;
  }

  app.post("/api/cart/validate", async (req, res) => {
    try {
      const items = req.body.items as Array<{productId: number; quantity: number; size?: string | null; color?: string | null}>;
      if (!items || !Array.isArray(items)) return res.status(400).json({ message: "Invalid items" });

      const products = new Map<number, any>();
      for (const item of items) {
        const product = await storage.getProduct(item.productId);
        if (product) products.set(item.productId, product);
      }

      const outOfStock = checkStockForItems(items, products);
      res.json({ valid: outOfStock.length === 0, outOfStock });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Validation error" });
    }
  });

  app.post(api.orders.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "يجب تسجيل الدخول لإتمام الطلب" });
    try {
      const input = api.orders.create.input.parse(req.body);
      const userId = (req.user as any).id;

      const products = new Map<number, any>();
      for (const item of input.items) {
        const product = await storage.getProduct(item.productId);
        if (product) products.set(item.productId, product);
      }

      const outOfStock = checkStockForItems(input.items, products);
      if (outOfStock.length > 0) {
        return res.status(400).json({
          message: "Some items are sold out",
          code: "OUT_OF_STOCK",
          outOfStock,
        });
      }
      
      const region = (input.order as any).shippingRegion as string | undefined;
      const shippingRates = await getShippingRates();
      if (!region || shippingRates[region] === undefined) {
        return res.status(400).json({ message: "Invalid or missing shipping region" });
      }
      const serverShippingCost = shippingRates[region];

      const verifiedItems: { productId: number; quantity: number; price: string; size?: string | null; color?: string | null }[] = [];
      let subtotal = 0;
      for (const item of input.items) {
        const product = await storage.getProduct(item.productId);
        if (!product) continue;
        const dbPrice = product.discountPrice ? Number(product.discountPrice) : Number(product.price);
        verifiedItems.push({ ...item, price: dbPrice.toString() });
        subtotal += dbPrice * item.quantity;
      }

      let discountAmount = 0;
      let appliedDiscountCode: string | null = null;
      const clientDiscountCode = (input.order as any).discountCode as string | undefined;
      if (clientDiscountCode) {
        const discount = await storage.validateDiscountCode(clientDiscountCode);
        if (discount) {
          let discountableSubtotal = subtotal;
          const hasCatFilter = discount.categoryIds && discount.categoryIds.length > 0;
          const hasSubCatFilter = discount.subcategoryIds && discount.subcategoryIds.length > 0;
          if (hasCatFilter || hasSubCatFilter) {
            discountableSubtotal = 0;
            for (const item of input.items) {
              const product = await storage.getProduct(item.productId);
              if (!product) continue;
              const catMatch = hasCatFilter && discount.categoryIds!.includes(product.categoryId);
              const subCatMatch = hasSubCatFilter && product.subcategoryId != null && discount.subcategoryIds!.includes(product.subcategoryId);
              if (catMatch || subCatMatch) {
                const price = product.discountPrice ? Number(product.discountPrice) : Number(product.price);
                discountableSubtotal += price * item.quantity;
              }
            }
          }
          discountAmount = Math.round(discountableSubtotal * (discount.discountPercent / 100) * 100) / 100;
          appliedDiscountCode = discount.code;
          await storage.useDiscountCode(discount.code);
        }
      }

      const totalAmount = subtotal - discountAmount + serverShippingCost;
      
      const order = await storage.createOrder({
        ...input.order,
        userId,
        totalAmount: totalAmount.toString(),
        shippingCost: serverShippingCost.toString(),
        shippingRegion: region,
        status: "Pending",
        discountCode: appliedDiscountCode,
        discountAmount: discountAmount > 0 ? discountAmount.toString() : null,
      }, verifiedItems);

      const itemDetails = verifiedItems.map((item) => {
        return {
          name: `Product #${item.productId}`,
          quantity: item.quantity,
          price: item.price,
          size: item.size,
          color: item.color,
        };
      });
      
      const productNames = await Promise.all(verifiedItems.map(async (item) => {
        const product = await storage.getProduct(item.productId);
        return product?.name || `Product #${item.productId}`;
      }));
      itemDetails.forEach((d, i) => { d.name = productNames[i]; });

      sendOrderNotification({
        orderId: order.id,
        customerName: input.order.fullName,
        phone: input.order.phone,
        address: input.order.address,
        city: input.order.city,
        totalAmount: totalAmount.toFixed(2),
        paymentMethod: input.order.paymentMethod || "Cash on delivery",
        items: itemDetails,
      }).catch(console.error);

      const customerUser = await storage.getUser(userId);
      if (customerUser?.email) {
        sendOrderConfirmationToCustomer(customerUser.email, {
          orderId: order.id,
          customerName: input.order.fullName,
          phone: input.order.phone,
          address: input.order.address,
          city: input.order.city,
          totalAmount: totalAmount.toFixed(2),
          shippingCost: serverShippingCost.toString(),
          shippingRegion: region || "",
          paymentMethod: input.order.paymentMethod || "Cash on delivery",
          items: itemDetails,
        }).catch(console.error);
      }
      
      res.status(201).json(order);
    } catch (err: any) {
      console.error(err);
      const msg: string = err?.message || "";
      if (msg.startsWith("STOCK_ERROR:")) {
        return res.status(409).json({
          message: msg.replace("STOCK_ERROR:", "").trim(),
          code: "OUT_OF_STOCK",
        });
      }
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.patch(api.orders.updateStatus.path, async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const input = api.orders.updateStatus.input.parse(req.body);
      const order = await storage.updateOrderStatus(Number(req.params.id), input.status);
      if (!order) return res.status(404).json({ message: "Not found" });
      res.json(order);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.patch("/api/orders/bulk-status", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { ids, status } = req.body as { ids: number[]; status: string };
      if (!ids || !Array.isArray(ids) || ids.length === 0 || !status) {
        return res.status(400).json({ message: "Invalid input" });
      }
      const results = await Promise.all(
        ids.map(id => storage.updateOrderStatus(id, status))
      );
      res.json({ updated: results.filter(Boolean).length });
    } catch (err) {
      res.status(400).json({ message: "Failed to update orders" });
    }
  });

  app.get("/api/admin/users/:id/orders", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = Number(req.params.id);
    const userOrders = await storage.getUserOrders(userId);
    res.json(userOrders);
  });

  // --- Admin Stats ---
  app.get(api.stats.admin.path, async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== 'admin') {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const stats = await storage.getStats();
    res.json(stats);
  });

  // Low-stock products list
  app.get("/api/admin/low-stock", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const allProducts = await storage.getProducts();
    const lowStock = allProducts
      .filter(p => p.stockQuantity < 3)
      .sort((a, b) => a.stockQuantity - b.stockQuantity)
      .map(p => ({
        id: p.id,
        name: p.name,
        stockQuantity: p.stockQuantity,
        mainImage: p.mainImage,
        price: p.price,
        categoryId: p.categoryId,
      }));
    res.json(lowStock);
  });

  // Bulk discount on low-stock products
  app.patch("/api/admin/products/bulk-discount", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { ids, discountPercent } = req.body as { ids: number[]; discountPercent: number };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "No product IDs provided" });
      }
      if (typeof discountPercent !== "number" || discountPercent <= 0 || discountPercent >= 100) {
        return res.status(400).json({ message: "Discount percent must be between 1 and 99" });
      }
      let updated = 0;
      for (const id of ids) {
        const product = await storage.getProduct(id);
        if (!product) continue;
        const basePrice = parseFloat(product.price);
        const discountPrice = (basePrice * (1 - discountPercent / 100)).toFixed(2);
        await storage.updateProduct(id, { discountPrice } as any);
        updated++;
      }
      res.json({ updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Remove discount from products
  app.patch("/api/admin/products/remove-discount", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { ids } = req.body as { ids: number[] };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "No product IDs provided" });
      }
      let updated = 0;
      for (const id of ids) {
        const product = await storage.getProduct(id);
        if (!product) continue;
        await storage.updateProduct(id, { discountPrice: null } as any);
        updated++;
      }
      res.json({ updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // --- Admin User Management ---
  app.get("/api/admin/users", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const allUsers = await storage.getAllUsers();
    const safeUsers = allUsers.map(({ password, verificationCode, ...u }) => u);
    res.json(safeUsers);
  });

  app.patch("/api/admin/users/:id", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const id = Number(req.params.id);
    const currentUser = req.user as any;
    if (currentUser.id === id && req.body.isBlocked === true) {
      return res.status(400).json({ message: "Cannot block your own account" });
    }
    const schema = z.object({
      isBlocked: z.boolean().optional(),
      role: z.enum(["admin", "customer", "employee"]).optional(),
    });
    const input = schema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: "Validation error" });
    const updated = await storage.updateUser(id, input.data as any);
    if (!updated) return res.status(404).json({ message: "User not found" });
    const { password, verificationCode, ...safeUser } = updated;
    res.json(safeUser);
  });

  app.delete("/api/admin/users/:id", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const id = Number(req.params.id);
    const currentUser = req.user as any;
    if (currentUser.id === id) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }
    const deleted = await storage.deleteUser(id);
    if (!deleted) return res.status(404).json({ message: "User not found" });
    res.json({ success: true });
  });

  app.patch("/api/admin/users/bulk", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const currentUser = req.user as any;
    const schema = z.object({
      ids: z.array(z.number()),
      action: z.enum(["block", "unblock", "make-admin", "make-customer"]),
    });
    const input = schema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: "Validation error" });
    const { ids, action } = input.data;
    const safeIds = ids.filter(id => id !== currentUser.id);
    if (safeIds.length === 0) return res.status(400).json({ message: "Cannot modify your own account" });
    const update =
      action === "block" ? { isBlocked: true } :
      action === "unblock" ? { isBlocked: false } :
      action === "make-admin" ? { role: "admin" } :
      { role: "customer" };
    await Promise.all(safeIds.map(id => storage.updateUser(id, update as any)));
    res.json({ updated: safeIds.length });
  });

  app.delete("/api/admin/users/bulk", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const currentUser = req.user as any;
    const schema = z.object({ ids: z.array(z.number()) });
    const input = schema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: "Validation error" });
    const safeIds = input.data.ids.filter(id => id !== currentUser.id);
    if (safeIds.length === 0) return res.status(400).json({ message: "Cannot delete your own account" });
    await Promise.all(safeIds.map(id => storage.deleteUser(id)));
    res.json({ deleted: safeIds.length });
  });

  // --- Reviews ---
  app.get(api.reviews.list.path, async (req, res) => {
    const productId = Number(req.params.productId);
    const reviews = await storage.getReviews(productId);
    res.json(reviews);
  });

  app.post(api.reviews.create.path, async (req, res) => {
    try {
      const input = api.reviews.create.input.parse(req.body);
      const review = await storage.createReview(input);
      res.status(201).json(review);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  // --- Wishlist ---
  app.get(api.wishlist.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const items = await storage.getWishlist((req.user as any).id);
    res.json(items);
  });

  app.get("/api/wishlist/products", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const items = await storage.getWishlistWithProducts((req.user as any).id);
    res.json(items);
  });

  app.post(api.wishlist.add.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const input = api.wishlist.add.input.parse(req.body);
      const item = await storage.addToWishlist((req.user as any).id, input.productId);
      res.status(201).json(item);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.delete(api.wishlist.remove.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const success = await storage.removeFromWishlist(Number(req.params.id));
    if (!success) return res.status(404).json({ message: "Not found" });
    res.status(204).send();
  });

  // --- Cart (server-persisted for logged-in users) ---
  const cartItemSchema = z.object({
    productId: z.number(),
    quantity: z.number().min(1).default(1),
    size: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
  });

  app.get("/api/cart", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const items = await storage.getCartItems((req.user as any).id);
    res.json(items);
  });

  app.post("/api/cart", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { productId, quantity, size, color } = cartItemSchema.parse(req.body);
      await storage.upsertCartItem((req.user as any).id, productId, quantity, size ?? null, color ?? null);
      const items = await storage.getCartItems((req.user as any).id);
      res.json(items);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.put("/api/cart/item", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { productId, quantity, size, color } = cartItemSchema.parse(req.body);
      await storage.updateCartItemQty((req.user as any).id, productId, quantity, size ?? null, color ?? null);
      const items = await storage.getCartItems((req.user as any).id);
      res.json(items);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.delete("/api/cart/item", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { productId, size, color } = z.object({
        productId: z.number(),
        size: z.string().nullable().optional(),
        color: z.string().nullable().optional(),
      }).parse(req.body);
      await storage.removeCartItem((req.user as any).id, productId, size ?? null, color ?? null);
      const items = await storage.getCartItems((req.user as any).id);
      res.json(items);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.delete("/api/cart", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    await storage.clearUserCart((req.user as any).id);
    res.json([]);
  });

  app.post("/api/cart/merge", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { items } = z.object({
        items: z.array(z.object({
          productId: z.number(),
          quantity: z.number().min(1),
          size: z.string().nullable().optional(),
          color: z.string().nullable().optional(),
        })),
      }).parse(req.body);
      await storage.mergeGuestCart((req.user as any).id, items);
      const merged = await storage.getCartItems((req.user as any).id);
      res.json(merged);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  // --- Discount Codes ---
  app.post(api.discounts.validate.path, async (req, res) => {
    try {
      const input = api.discounts.validate.input.parse(req.body);
      const discount = await storage.validateDiscountCode(input.code);
      if (!discount) return res.status(404).json({ message: "Invalid or expired code" });
      res.json(discount);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.get("/api/admin/discount-codes", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") return res.status(401).json({ message: "Unauthorized" });
    const codes = await storage.getAllDiscountCodes();
    res.json(codes);
  });

  app.post("/api/admin/discount-codes", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") return res.status(401).json({ message: "Unauthorized" });
    try {
      const { code, discountPercent, maxUses, expiresAt, isActive, categoryIds, subcategoryIds } = req.body;
      if (!code || !discountPercent) return res.status(400).json({ message: "Code and discount percent are required" });
      if (Number(discountPercent) < 1 || Number(discountPercent) > 100) return res.status(400).json({ message: "Discount percent must be between 1 and 100" });
      if (maxUses && Number(maxUses) < 1) return res.status(400).json({ message: "Max uses must be at least 1" });
      const created = await storage.createDiscountCode({
        code: code.toUpperCase().trim(),
        discountPercent: Number(discountPercent),
        maxUses: maxUses ? Number(maxUses) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: isActive !== false,
        categoryIds: Array.isArray(categoryIds) && categoryIds.length > 0 ? categoryIds.map(Number) : null,
        subcategoryIds: Array.isArray(subcategoryIds) && subcategoryIds.length > 0 ? subcategoryIds.map(Number) : null,
      });
      res.json(created);
    } catch (err: any) {
      if (err.code === "23505") return res.status(400).json({ message: "Code already exists" });
      res.status(400).json({ message: err.message || "Failed to create discount code" });
    }
  });

  app.patch("/api/admin/discount-codes/:id", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") return res.status(401).json({ message: "Unauthorized" });
    try {
      const id = Number(req.params.id);
      const { code, discountPercent, maxUses, expiresAt, isActive, categoryIds, subcategoryIds } = req.body;
      if (discountPercent !== undefined && (Number(discountPercent) < 1 || Number(discountPercent) > 100)) return res.status(400).json({ message: "Discount percent must be between 1 and 100" });
      if (maxUses !== undefined && maxUses !== null && Number(maxUses) < 1) return res.status(400).json({ message: "Max uses must be at least 1" });
      const updates: any = {};
      if (code !== undefined) updates.code = code.toUpperCase().trim();
      if (discountPercent !== undefined) updates.discountPercent = Number(discountPercent);
      if (maxUses !== undefined) updates.maxUses = maxUses ? Number(maxUses) : null;
      if (expiresAt !== undefined) updates.expiresAt = expiresAt ? new Date(expiresAt) : null;
      if (isActive !== undefined) updates.isActive = isActive;
      if (categoryIds !== undefined) updates.categoryIds = Array.isArray(categoryIds) && categoryIds.length > 0 ? categoryIds.map(Number) : null;
      if (subcategoryIds !== undefined) updates.subcategoryIds = Array.isArray(subcategoryIds) && subcategoryIds.length > 0 ? subcategoryIds.map(Number) : null;
      const updated = await storage.updateDiscountCode(id, updates);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      if (err.code === "23505") return res.status(400).json({ message: "Code already exists" });
      res.status(400).json({ message: err.message || "Failed to update" });
    }
  });

  app.delete("/api/admin/discount-codes/:id", async (req, res) => {
    if (!req.isAuthenticated() || (req.user as any).role !== "admin") return res.status(401).json({ message: "Unauthorized" });
    const success = await storage.deleteDiscountCode(Number(req.params.id));
    if (!success) return res.status(404).json({ message: "Not found" });
    res.status(204).send();
  });

  // --- Stripe Routes ---
  app.get(api.stripe.publishableKey.path, async (_req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (err) {
      res.json({ publishableKey: null });
    }
  });

  app.post(api.stripe.createCheckout.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "يجب تسجيل الدخول لإتمام الطلب" });
    try {
      const input = api.stripe.createCheckout.input.parse(req.body);
      const userId = (req.user as any).id;

      const verifiedItems: any[] = [];
      const lineItems = await Promise.all(input.items.map(async (item) => {
        const product = await storage.getProduct(item.productId);
        if (!product) throw new Error(`Product ${item.productId} not found`);
        const dbPrice = product.discountPrice ? Number(product.discountPrice) : Number(product.price);
        const unitAmount = Math.round(dbPrice * 100);
        const sizePart = item.size ? ` - ${item.size}` : "";
        const colorPart = item.color ? ` (${item.color})` : "";
        verifiedItems.push({ ...item, price: dbPrice.toString() });
        return {
          price_data: {
            currency: "ils",
            product_data: {
              name: `${product.name}${sizePart}${colorPart}`,
              images: product.mainImage ? [product.mainImage.startsWith("http") ? product.mainImage : `https://${req.headers.host}${product.mainImage}`] : [],
            },
            unit_amount: unitAmount,
          },
          quantity: item.quantity,
        };
      }));

      const stripeCheckoutRegion = input.order.shippingRegion;
      const stripeCheckoutRates = await getShippingRates();
      if (!stripeCheckoutRegion || stripeCheckoutRates[stripeCheckoutRegion] === undefined) {
        return res.status(400).json({ message: "Invalid or missing shipping region" });
      }
      const stripeCheckoutShipping = stripeCheckoutRates[stripeCheckoutRegion];

      let stripeDiscountAmount = 0;
      let stripeAppliedCode: string | null = null;
      const stripeClientCode = (input.order as any).discountCode as string | undefined;
      if (stripeClientCode) {
        const discount = await storage.validateDiscountCode(stripeClientCode);
        if (discount) {
          let discountableSubtotal = verifiedItems.reduce((acc: number, i: any) => acc + Number(i.price) * i.quantity, 0);
          const hasCatFilter2 = discount.categoryIds && discount.categoryIds.length > 0;
          const hasSubCatFilter2 = discount.subcategoryIds && discount.subcategoryIds.length > 0;
          if (hasCatFilter2 || hasSubCatFilter2) {
            discountableSubtotal = 0;
            for (const item of input.items) {
              const product = await storage.getProduct(item.productId);
              if (!product) continue;
              const catMatch = hasCatFilter2 && discount.categoryIds!.includes(product.categoryId);
              const subCatMatch = hasSubCatFilter2 && product.subcategoryId != null && discount.subcategoryIds!.includes(product.subcategoryId);
              if (catMatch || subCatMatch) {
                const price = product.discountPrice ? Number(product.discountPrice) : Number(product.price);
                discountableSubtotal += price * item.quantity;
              }
            }
          }
          stripeDiscountAmount = Math.round(discountableSubtotal * (discount.discountPercent / 100) * 100) / 100;
          stripeAppliedCode = discount.code;
        }
      }

      if (stripeCheckoutShipping > 0) {
        lineItems.push({
          price_data: {
            currency: "ils",
            product_data: {
              name: "Shipping / الشحن",
              images: [],
            },
            unit_amount: Math.round(stripeCheckoutShipping * 100),
          },
          quantity: 1,
        });
      }

      const stripe = await getUncachableStripeClient();
      const baseUrl = `https://${req.headers.host}`;

      const metadata: Record<string, string> = {
        orderData: JSON.stringify({
          ...input.order,
          userId,
          paymentMethod: "Card",
          discountCode: stripeAppliedCode,
          discountAmount: stripeDiscountAmount > 0 ? stripeDiscountAmount : null,
        }),
        itemsData: JSON.stringify(verifiedItems),
      };

      const sessionOptions: any = {
        payment_method_types: ["card"],
        line_items: lineItems,
        mode: "payment",
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/checkout`,
        metadata,
      };

      if (stripeDiscountAmount > 0) {
        const coupon = await stripe.coupons.create({
          amount_off: Math.round(stripeDiscountAmount * 100),
          currency: "ils",
          duration: "once",
          name: `Discount ${stripeAppliedCode}`,
        });
        sessionOptions.discounts = [{ coupon: coupon.id }];
      }

      const session = await stripe.checkout.sessions.create(sessionOptions);

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("Stripe checkout error:", err);
      res.status(400).json({ message: err.message || "Failed to create checkout session" });
    }
  });

  // --- Lahza Payment Routes ---
  const pendingLahzaOrders = new Map<string, any>();

  app.post("/api/lahza/create-checkout", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "يجب تسجيل الدخول لإتمام الطلب" });
    try {
      const { order, items } = req.body;
      if (!order || !items || !Array.isArray(items)) {
        return res.status(400).json({ message: "Invalid request" });
      }

      const userId = (req.user as any).id;
      const userObj = await storage.getUser(userId);

      const lahzaShippingRates = await getShippingRates();
      if (!order.shippingRegion || lahzaShippingRates[order.shippingRegion] === undefined) {
        return res.status(400).json({ message: "Invalid or missing shipping region" });
      }

      const products = new Map<number, any>();
      const verifiedItems: any[] = [];
      let subtotal = 0;
      for (const item of items) {
        const product = await storage.getProduct(item.productId);
        if (!product) return res.status(400).json({ message: `Product ${item.productId} not found` });
        products.set(item.productId, product);
        const dbPrice = product.discountPrice ? Number(product.discountPrice) : Number(product.price);
        subtotal += dbPrice * item.quantity;
        verifiedItems.push({ ...item, price: dbPrice.toString() });
      }

      const outOfStock = checkStockForItems(items, products);
      if (outOfStock.length > 0) {
        return res.status(400).json({
          message: "Some items are sold out",
          code: "OUT_OF_STOCK",
          outOfStock,
        });
      }

      let lahzaDiscountAmount = 0;
      let lahzaAppliedCode: string | null = null;
      if (order.discountCode) {
        const dsc = await storage.validateDiscountCode(order.discountCode);
        if (dsc) {
          lahzaDiscountAmount = Math.round(subtotal * (dsc.discountPercent / 100) * 100) / 100;
          lahzaAppliedCode = dsc.code;
        }
      }

      const shippingCost = lahzaShippingRates[order.shippingRegion];
      const totalAmount = subtotal - lahzaDiscountAmount + shippingCost;
      const reference = `LUC-${Date.now()}-${userId}`;
      const baseUrl = `https://${req.headers.host}`;

      const lahzaResult = await initializeLahzaTransaction({
        email: userObj?.email || `user${userId}@lucerneboutique.com`,
        amount: totalAmount,
        reference,
        callback_url: `${baseUrl}/checkout/success?reference=${reference}`,
      });

      pendingLahzaOrders.set(reference, {
        orderData: { ...order, userId, paymentMethod: "Card (Lahza)", discountCode: lahzaAppliedCode, discountAmount: lahzaDiscountAmount > 0 ? lahzaDiscountAmount : null },
        items: verifiedItems,
        shippingCost,
        totalAmount,
        userEmail: userObj?.email || "",
      });

      res.json({ url: lahzaResult.authorization_url, reference });
    } catch (err: any) {
      console.error("Lahza create-checkout error:", err);
      res.status(400).json({ message: err.message || "Failed to create checkout" });
    }
  });

  app.get("/api/lahza/verify", async (req, res) => {
    try {
      const reference = req.query.reference as string;
      if (!reference) return res.status(400).json({ message: "Missing reference" });

      const pending = pendingLahzaOrders.get(reference);
      if (!pending) return res.status(404).json({ message: "Order not found or already processed" });

      const { orderData, items, shippingCost, totalAmount, userEmail } = pending;

      const verification = await verifyLahzaTransaction(reference);
      if (verification.status !== "success") {
        return res.status(400).json({ message: "Payment not completed" });
      }

      if (orderData.discountCode) {
        await storage.useDiscountCode(orderData.discountCode);
      }

      const order = await storage.createOrder({
        fullName: orderData.fullName,
        phone: orderData.phone,
        phone2: orderData.phone2 || null,
        address: orderData.address,
        city: orderData.city,
        notes: orderData.notes || null,
        userId: orderData.userId,
        totalAmount: totalAmount.toFixed(2),
        shippingCost: shippingCost.toString(),
        shippingRegion: orderData.shippingRegion || null,
        status: "Pending",
        paymentMethod: "Card (Lahza)",
        discountCode: orderData.discountCode || null,
        discountAmount: orderData.discountAmount ? orderData.discountAmount.toString() : null,
      }, items);

      pendingLahzaOrders.delete(reference);

      const itemDetails = await Promise.all(items.map(async (item: any) => {
        const product = await storage.getProduct(item.productId);
        return {
          name: product?.name || `Product #${item.productId}`,
          quantity: item.quantity,
          price: item.price,
          size: item.size,
          color: item.color,
        };
      }));

      sendOrderNotification({
        orderId: order.id,
        customerName: orderData.fullName,
        phone: orderData.phone,
        address: orderData.address,
        city: orderData.city,
        totalAmount: totalAmount.toFixed(2),
        paymentMethod: "Card (Lahza)",
        items: itemDetails,
      }).catch(console.error);

      if (userEmail) {
        sendOrderConfirmationToCustomer(userEmail, {
          orderId: order.id,
          customerName: orderData.fullName,
          phone: orderData.phone,
          address: orderData.address,
          city: orderData.city,
          totalAmount: totalAmount.toFixed(2),
          shippingCost: shippingCost.toString(),
          shippingRegion: orderData.shippingRegion || "",
          paymentMethod: "Card (Lahza)",
          items: itemDetails,
        }).catch(console.error);
      }

      res.json({ order });
    } catch (err: any) {
      console.error("Lahza verify error:", err);
      res.status(500).json({ message: err.message || "Failed to process payment confirmation" });
    }
  });

  const processedStripeSessions = new Set<string>();

  app.get("/api/stripe/checkout-success", async (req, res) => {
    try {
      const sessionId = req.query.session_id as string;
      if (!sessionId) return res.status(400).json({ message: "Missing session_id" });

      if (processedStripeSessions.has(sessionId)) {
        return res.status(409).json({ message: "Session already processed" });
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid") {
        return res.status(400).json({ message: "Payment not completed" });
      }

      const existingOrders = await storage.getOrders();
      const alreadyCreated = existingOrders.find((o: any) => o.notes && o.notes.includes(`stripe:${sessionId}`));
      if (alreadyCreated) {
        processedStripeSessions.add(sessionId);
        return res.json({ order: alreadyCreated });
      }

      const orderData = JSON.parse(session.metadata?.orderData || "{}");
      const itemsData = JSON.parse(session.metadata?.itemsData || "[]");

      const subtotal = itemsData.reduce((acc: number, item: any) => acc + (Number(item.price) * item.quantity), 0);
      const stripeRegion = orderData.shippingRegion as string | undefined;
      const stripeSuccessRates = await getShippingRates();
      const stripeShippingCost = stripeRegion && stripeSuccessRates[stripeRegion] !== undefined ? stripeSuccessRates[stripeRegion] : 0;
      const stripeOrderDiscount = orderData.discountAmount ? Number(orderData.discountAmount) : 0;
      const totalAmount = subtotal - stripeOrderDiscount + stripeShippingCost;

      if (orderData.discountCode) {
        await storage.useDiscountCode(orderData.discountCode);
      }

      const stripeNotes = orderData.notes ? `${orderData.notes} | stripe:${sessionId}` : `stripe:${sessionId}`;
      const order = await storage.createOrder({
        fullName: orderData.fullName,
        phone: orderData.phone,
        address: orderData.address,
        city: orderData.city,
        notes: stripeNotes,
        userId: orderData.userId,
        totalAmount: totalAmount.toFixed(2),
        shippingCost: stripeShippingCost.toString(),
        shippingRegion: stripeRegion || null,
        status: "Pending",
        paymentMethod: "Card",
        discountCode: orderData.discountCode || null,
        discountAmount: stripeOrderDiscount > 0 ? stripeOrderDiscount.toString() : null,
      }, itemsData);

      processedStripeSessions.add(sessionId);

      const itemDetails = await Promise.all(itemsData.map(async (item: any) => {
        const product = await storage.getProduct(item.productId);
        return {
          name: product?.name || `Product #${item.productId}`,
          quantity: item.quantity,
          price: item.price,
          size: item.size,
          color: item.color,
        };
      }));

      sendOrderNotification({
        orderId: order.id,
        customerName: orderData.fullName,
        phone: orderData.phone,
        address: orderData.address,
        city: orderData.city,
        totalAmount: totalAmount.toFixed(2),
        paymentMethod: "Card (Stripe)",
        items: itemDetails,
      }).catch(console.error);

      if (orderData.userId) {
        const customerUser = await storage.getUser(orderData.userId);
        if (customerUser?.email) {
          sendOrderConfirmationToCustomer(customerUser.email, {
            orderId: order.id,
            customerName: orderData.fullName,
            phone: orderData.phone,
            address: orderData.address,
            city: orderData.city,
            totalAmount: totalAmount.toFixed(2),
            shippingCost: stripeShippingCost.toString(),
            shippingRegion: stripeRegion || "",
            paymentMethod: "Card (Stripe)",
            items: itemDetails,
          }).catch(console.error);
        }
      }

      res.json({ order });
    } catch (err: any) {
      console.error("Stripe success handler error:", err);
      res.status(500).json({ message: "Failed to process payment confirmation" });
    }
  });

  // Site Settings (public read, admin write)
  app.get("/api/site-settings", async (_req, res) => {
    try {
      const settings = await storage.getSiteSettings();
      const map: Record<string, string> = {};
      settings.forEach(s => { map[s.key] = s.value; });
      res.json(map);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to get site settings" });
    }
  });

  app.post("/api/site-settings", async (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key || value === undefined) return res.status(400).json({ message: "key and value are required" });
      const setting = await storage.setSiteSetting(key, value);
      res.json(setting);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to save setting" });
    }
  });

  app.post("/api/site-settings/bulk", async (req, res) => {
    try {
      const updates: Record<string, string> = req.body;
      const results = await Promise.all(
        Object.entries(updates).map(([key, value]) => storage.setSiteSetting(key, value))
      );
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to save settings" });
    }
  });

  // POS routes
  app.get("/api/pos/search-barcode/:barcode", async (req, res) => {
    if (!req.isAuthenticated() || !["admin", "employee"].includes(req.user.role)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const product = await storage.getProductByBarcode(req.params.barcode);
      if (!product) return res.status(404).json({ message: "product_not_found" });
      res.json(product);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/pos/orders/:id", async (req, res) => {
    if (!req.isAuthenticated() || !["admin", "employee"].includes(req.user.role)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const order = await storage.getPosOrderById(parseInt(req.params.id));
      if (!order) return res.status(404).json({ message: "Order not found" });
      res.json(order);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/return", async (req, res) => {
    if (!req.isAuthenticated() || !["admin", "employee"].includes(req.user.role)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { orderId, items: returnItems } = req.body;
      if (!orderId || !returnItems || !Array.isArray(returnItems) || returnItems.length === 0) {
        return res.status(400).json({ message: "Invalid return data" });
      }
      const order = await storage.getPosOrderById(parseInt(orderId));
      if (!order) return res.status(404).json({ message: "Order not found" });
      for (const ri of returnItems) {
        const product = await storage.getProduct(ri.productId);
        if (!product) continue;
        const colorVariants = (product.colorVariants as any[]) || [];
        if (colorVariants.length > 0 && ri.color) {
          const updatedVariants = colorVariants.map((cv: any) => {
            if (cv.name !== ri.color) return cv;
            const inv = { ...(cv.sizeInventory || {}) };
            if (ri.size && inv[ri.size] !== undefined) inv[ri.size] = (inv[ri.size] || 0) + ri.quantity;
            return { ...cv, sizeInventory: inv };
          });
          const mergedSizeInv: Record<string, number> = {};
          updatedVariants.forEach((cv: any) => {
            Object.entries(cv.sizeInventory || {}).forEach(([size, qty]) => {
              mergedSizeInv[size] = (mergedSizeInv[size] || 0) + (qty as number);
            });
          });
          const totalStock = updatedVariants.reduce((sum: number, cv: any) =>
            sum + Object.values(cv.sizeInventory || {}).reduce((s: number, q: any) => s + (q as number), 0), 0);
          await storage.updateProduct(product.id, { colorVariants: updatedVariants, sizeInventory: mergedSizeInv, stockQuantity: totalStock } as any);
        } else {
          const inv = { ...(product.sizeInventory as Record<string, number> || {}) };
          if (ri.size && inv[ri.size] !== undefined) inv[ri.size] = (inv[ri.size] || 0) + ri.quantity;
          const newStock = product.stockQuantity + ri.quantity;
          await storage.updateProduct(product.id, { sizeInventory: inv, stockQuantity: newStock } as any);
        }
      }
      res.json({ success: true, message: "Return processed" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/orders", async (req, res) => {
    if (!req.isAuthenticated() || !["admin", "employee"].includes(req.user.role)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { paymentMethod, items, note, cashAmount, cardAmount } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items provided" });
      }
      let computedTotal = 0;
      const validatedItems: any[] = [];
      for (const item of items) {
        if (!item.productId || !item.quantity || item.quantity < 1) {
          return res.status(400).json({ message: "Invalid item data" });
        }
        const product = await storage.getProduct(item.productId);
        if (!product) {
          return res.status(400).json({ message: `Product ${item.productId} not found` });
        }
        const price = product.discountPrice ? parseFloat(product.discountPrice) : parseFloat(product.price);
        computedTotal += price * item.quantity;
        validatedItems.push({ ...item, price: price.toFixed(2), name: product.name, barcode: product.barcode || null });
      }
      const stockItems = validatedItems.map((item: any) => ({
        productId: item.productId,
        color: item.color || undefined,
        size: item.size || undefined,
        quantity: item.quantity,
      }));
      const order = await storage.createPosOrderAtomic(
        {
          totalAmount: computedTotal.toFixed(2),
          paymentMethod: paymentMethod || "cash",
          items: validatedItems,
          note: note || null,
          cashAmount: cashAmount ? String(cashAmount) : null,
          cardAmount: cardAmount ? String(cardAmount) : null,
        },
        stockItems
      );
      res.json(order);
    } catch (err: any) {
      const msg: string = err.message || "";
      if (msg.startsWith("STOCK_ERROR:")) {
        return res.status(409).json({ message: msg.replace("STOCK_ERROR:", "").trim() });
      }
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/pos/orders", async (req, res) => {
    if (!req.isAuthenticated() || !["admin", "employee"].includes(req.user.role)) return res.status(401).json({ message: "Unauthorized" });
    try {
      const orders = await storage.getPosOrders();
      res.json(orders);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/analytics", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") return res.status(401).json({ message: "Unauthorized" });
    try {
      // Optional month filter e.g. "2026-04". Empty = all time (last 12 months for chart)
      const monthParam = (req.query.month as string) || "";
      const hasMonth = /^\d{4}-\d{2}$/.test(monthParam);

      const websiteMonthlyResult = await db.execute(sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
          COALESCE(SUM(total_amount::numeric - COALESCE(shipping_cost::numeric, 0)), 0) AS revenue,
          COUNT(*)::int AS order_count
        FROM orders
        WHERE status = 'Delivered'
          AND created_at >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)
      `);

      const posMonthlyResult = await db.execute(sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
          COALESCE(SUM(total_amount::numeric), 0) AS revenue,
          COUNT(*)::int AS order_count
        FROM pos_orders
        WHERE created_at >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)
      `);

      const websiteCategoryResult = await db.execute(
        hasMonth
          ? sql`
              SELECT c.name AS category, COALESCE(c.name_ar, c.name) AS category_ar,
                COALESCE(SUM(oi.price::numeric * oi.quantity), 0) AS revenue
              FROM order_items oi
              JOIN products p ON p.id = oi.product_id
              JOIN categories c ON c.id = p.category_id
              JOIN orders o ON o.id = oi.order_id
              WHERE o.status = 'Delivered'
                AND TO_CHAR(o.created_at, 'YYYY-MM') = ${monthParam}
              GROUP BY c.id, c.name, c.name_ar ORDER BY revenue DESC`
          : sql`
              SELECT c.name AS category, COALESCE(c.name_ar, c.name) AS category_ar,
                COALESCE(SUM(oi.price::numeric * oi.quantity), 0) AS revenue
              FROM order_items oi
              JOIN products p ON p.id = oi.product_id
              JOIN categories c ON c.id = p.category_id
              JOIN orders o ON o.id = oi.order_id
              WHERE o.status = 'Delivered'
              GROUP BY c.id, c.name, c.name_ar ORDER BY revenue DESC`
      );

      const posCategoryResult = await db.execute(
        hasMonth
          ? sql`
              SELECT c.name AS category, COALESCE(c.name_ar, c.name) AS category_ar,
                COALESCE(SUM((item->>'price')::numeric * (item->>'quantity')::integer), 0) AS revenue
              FROM pos_orders po
              CROSS JOIN LATERAL jsonb_array_elements(po.items) AS item
              JOIN products p ON p.id = (item->>'productId')::integer
              JOIN categories c ON c.id = p.category_id
              WHERE TO_CHAR(po.created_at, 'YYYY-MM') = ${monthParam}
              GROUP BY c.id, c.name, c.name_ar ORDER BY revenue DESC`
          : sql`
              SELECT c.name AS category, COALESCE(c.name_ar, c.name) AS category_ar,
                COALESCE(SUM((item->>'price')::numeric * (item->>'quantity')::integer), 0) AS revenue
              FROM pos_orders po
              CROSS JOIN LATERAL jsonb_array_elements(po.items) AS item
              JOIN products p ON p.id = (item->>'productId')::integer
              JOIN categories c ON c.id = p.category_id
              GROUP BY c.id, c.name, c.name_ar ORDER BY revenue DESC`
      );

      const websiteTotalResult = await db.execute(
        hasMonth
          ? sql`SELECT COALESCE(SUM(total_amount::numeric - COALESCE(shipping_cost::numeric, 0)), 0) AS total FROM orders WHERE status = 'Delivered' AND TO_CHAR(created_at, 'YYYY-MM') = ${monthParam}`
          : sql`SELECT COALESCE(SUM(total_amount::numeric - COALESCE(shipping_cost::numeric, 0)), 0) AS total FROM orders WHERE status = 'Delivered'`
      );
      const posTotalResult = await db.execute(
        hasMonth
          ? sql`SELECT COALESCE(SUM(total_amount::numeric), 0) AS total FROM pos_orders WHERE TO_CHAR(created_at, 'YYYY-MM') = ${monthParam}`
          : sql`SELECT COALESCE(SUM(total_amount::numeric), 0) AS total FROM pos_orders`
      );

      // Payment method breakdown for website orders (cash vs card)
      const websitePaymentResult = await db.execute(
        hasMonth
          ? sql`
              SELECT
                CASE WHEN payment_method = 'Cash on delivery' THEN 'cash' ELSE 'card' END AS payment_type,
                COALESCE(SUM(total_amount::numeric - COALESCE(shipping_cost::numeric, 0)), 0) AS revenue
              FROM orders
              WHERE status = 'Delivered' AND TO_CHAR(created_at, 'YYYY-MM') = ${monthParam}
              GROUP BY payment_type`
          : sql`
              SELECT
                CASE WHEN payment_method = 'Cash on delivery' THEN 'cash' ELSE 'card' END AS payment_type,
                COALESCE(SUM(total_amount::numeric - COALESCE(shipping_cost::numeric, 0)), 0) AS revenue
              FROM orders
              WHERE status = 'Delivered'
              GROUP BY payment_type`
      );

      // Payment method breakdown for POS (cash_amount vs card_amount)
      const posPaymentResult = await db.execute(
        hasMonth
          ? sql`SELECT COALESCE(SUM(cash_amount::numeric), 0) AS cash_total, COALESCE(SUM(card_amount::numeric), 0) AS card_total FROM pos_orders WHERE TO_CHAR(created_at, 'YYYY-MM') = ${monthParam}`
          : sql`SELECT COALESCE(SUM(cash_amount::numeric), 0) AS cash_total, COALESCE(SUM(card_amount::numeric), 0) AS card_total FROM pos_orders`
      );

      // Per-category payment breakdown for website orders
      const websiteCategoryPaymentResult = await db.execute(
        hasMonth
          ? sql`
              SELECT c.name AS category, COALESCE(c.name_ar, c.name) AS category_ar,
                CASE WHEN o.payment_method = 'Cash on delivery' THEN 'cash' ELSE 'card' END AS payment_type,
                COALESCE(SUM(oi.price::numeric * oi.quantity), 0) AS revenue
              FROM order_items oi
              JOIN products p ON p.id = oi.product_id
              JOIN categories c ON c.id = p.category_id
              JOIN orders o ON o.id = oi.order_id
              WHERE o.status = 'Delivered' AND TO_CHAR(o.created_at, 'YYYY-MM') = ${monthParam}
              GROUP BY c.id, c.name, c.name_ar, payment_type ORDER BY c.name`
          : sql`
              SELECT c.name AS category, COALESCE(c.name_ar, c.name) AS category_ar,
                CASE WHEN o.payment_method = 'Cash on delivery' THEN 'cash' ELSE 'card' END AS payment_type,
                COALESCE(SUM(oi.price::numeric * oi.quantity), 0) AS revenue
              FROM order_items oi
              JOIN products p ON p.id = oi.product_id
              JOIN categories c ON c.id = p.category_id
              JOIN orders o ON o.id = oi.order_id
              WHERE o.status = 'Delivered'
              GROUP BY c.id, c.name, c.name_ar, payment_type ORDER BY c.name`
      );

      // Build payment by category map
      const paymentCategoryMap: Record<string, { category: string; category_ar: string; cash: number; card: number }> = {};
      for (const row of websiteCategoryPaymentResult.rows as any[]) {
        if (!paymentCategoryMap[row.category]) {
          paymentCategoryMap[row.category] = { category: row.category, category_ar: row.category_ar, cash: 0, card: 0 };
        }
        paymentCategoryMap[row.category][row.payment_type as "cash" | "card"] += Number(row.revenue);
      }

      res.json({
        websiteMonthly: websiteMonthlyResult.rows,
        posMonthly: posMonthlyResult.rows,
        websiteCategoryRevenue: websiteCategoryResult.rows,
        posCategoryRevenue: posCategoryResult.rows,
        websiteTotal: Number((websiteTotalResult.rows[0] as any)?.total ?? 0),
        posTotal: Number((posTotalResult.rows[0] as any)?.total ?? 0),
        websitePaymentBreakdown: websitePaymentResult.rows,
        posPaymentBreakdown: {
          cash: Number((posPaymentResult.rows[0] as any)?.cash_total ?? 0),
          card: Number((posPaymentResult.rows[0] as any)?.card_total ?? 0),
        },
        paymentByCategory: Object.values(paymentCategoryMap),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}