const fs = require("fs");
const admin = require("firebase-admin");

// Initialize Firebase Admin using environment-provided credentials.
// Preferred: GOOGLE_APPLICATION_CREDENTIALS pointing to a secure JSON file.
// Alternatives: FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_BASE64.
function initAdmin() {
	if (admin.apps && admin.apps.length) return admin;

	const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
	const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
	const saBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

	try {
		if (gac && fs.existsSync(gac)) {
			// Application Default Credentials via env var path
			admin.initializeApp({ credential: admin.credential.applicationDefault() });
			return admin;
		}

		if (saPath && fs.existsSync(saPath)) {
			const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf8"));
			admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
			return admin;
		}

		if (saBase64) {
			const json = Buffer.from(saBase64, "base64").toString("utf8");
			const serviceAccount = JSON.parse(json);
			admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
			return admin;
		}

		// Fallback: attempt ADC without explicit file; may work in managed envs
		admin.initializeApp({ credential: admin.credential.applicationDefault() });
		return admin;
	} catch (e) {
		// As a last resort, throw a clear error to prompt proper configuration
		throw new Error(
			"Failed to initialize Firebase Admin. Set GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT_PATH, or FIREBASE_SERVICE_ACCOUNT_BASE64. " +
				(e && e.message ? e.message : String(e))
		);
	}
}

module.exports = initAdmin();
