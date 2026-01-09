/**
 * Cryptographic utilities for git identity and signature verification
 */

// Key extraction, detection, and formatting
export {
	detectKeyTypeFromContent,
	extractPGPKeyMaterial,
	extractSSHKeyMaterial,
	extractX509CertMaterial,
	formatKeyForStorage,
	generateKeyFingerprint,
	generatePGPKeyFingerprint,
	getFullPGPKey,
	getKeyTypeName,
} from "./keys.js";

// Signature generation and verification
export {
	generatePGPKeyPair,
	generatePGPSignature,
	generateSigningMessage,
	generateSSHSignature,
	preparePGPKeyForRegistration,
	verifyGitKeyClaimSignature,
	verifyPGPSignature,
	verifySSHSignature,
} from "./signatures.js";

// Git commit signature verification
export { verifyRepo } from "./verification.js";

// Key validation
export {
	validateKeyForGitSigning,
	validatePGPKey,
	validatePGPKeyRegistration,
	validateX509Certificate,
} from "./validation.js";

// Git server key management
export {
	getServerGitCapabilities,
	importGPGKeyToServer,
	importSSHKeyToServer,
	initializeServerGitEnvironment,
	isGPGKeyImported,
	isSSHKeyImported,
	removeGPGKeyFromServer,
	removeSSHKeyFromServer,
} from "./server.js";
