const isNode = typeof window === 'undefined';
// WhatsApp's in-app browser (WKWebView) blocks localStorage entirely —
// accessing window.localStorage throws SecurityError: "The operation is insecure."
// Fallback to an in-memory Map so the app still works (just without persistence).
let storage;
if (isNode) {
	storage = new Map();
} else {
	try {
		const ls = window.localStorage;
		// Test actual access — some browsers allow the property but throw on use
		ls.getItem('__test');
		storage = ls;
	} catch (e) {
		console.warn('[app-params] localStorage unavailable, using in-memory fallback:', e.message);
		const memStore = {};
		storage = {
			getItem: (k) => memStore[k] ?? null,
			setItem: (k, v) => { memStore[k] = String(v); },
			removeItem: (k) => { delete memStore[k]; },
			clear: () => { Object.keys(memStore).forEach(k => delete memStore[k]); },
		};
	}
}

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const storageKey = `base44_${toSnakeCase(paramName)}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = urlParams.get(paramName);
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
			}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		storage.setItem(storageKey, searchParam);
		return searchParam;
	}
	if (defaultValue) {
		storage.setItem(storageKey, defaultValue);
		return defaultValue;
	}
	const storedValue = storage.getItem(storageKey);
	if (storedValue) {
		return storedValue;
	}
	return null;
}

const getAppParams = () => {
	if (getAppParamValue("clear_access_token") === 'true') {
		storage.removeItem('base44_access_token');
		storage.removeItem('token');
	}
	return {
		appId: getAppParamValue("app_id", { defaultValue: import.meta.env.VITE_BASE44_APP_ID }),
		token: getAppParamValue("access_token", { removeFromUrl: true }),
		fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href }),
		functionsVersion: getAppParamValue("functions_version", { defaultValue: import.meta.env.VITE_BASE44_FUNCTIONS_VERSION }),
		appBaseUrl: getAppParamValue("app_base_url", { defaultValue: import.meta.env.VITE_BASE44_APP_BASE_URL }),
	}
}


export const appParams = {
	...getAppParams()
}
