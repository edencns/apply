import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

// 요청 인터셉터: JWT 토큰 자동 첨부
api.interceptors.request.use((config) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 응답 인터셉터: 인증 만료 처리
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ─── API 함수 모음 ─────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    api.post("/auth/login", new URLSearchParams({ username: email, password })),
};

export const sitesApi = {
  list: () => api.get("/sites/"),
  get: (id: number) => api.get(`/sites/${id}`),
  create: (data: object) => api.post("/sites/", data),
};

export const customersApi = {
  list: (siteId: number, status?: string) =>
    api.get(`/customers/site/${siteId}`, { params: { status } }),
  get: (id: number) => api.get(`/customers/${id}`),
  create: (data: object) => api.post("/customers/", data),
  listDocuments: (customerId: number) => api.get(`/documents/customer/${customerId}`),
};

export const documentsApi = {
  upload: (customerId: number, file: File, docType?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (docType) form.append("doc_type", docType);
    return api.post(`/documents/upload/${customerId}`, form);
  },
  get: (docId: number) => api.get(`/documents/${docId}`),
};

export const eligibilityApi = {
  check: (winnerId: number) => api.post(`/eligibility/check/${winnerId}`),
  calculateScore: (params: { no_home_years: number; dependents_count: number; subscription_months: number }) =>
    api.get("/eligibility/score-calculator", { params }),
};

export const contractsApi = {
  generate: (winnerId: number) => api.post(`/contracts/generate/${winnerId}`),
  walkIn: (data: { name: string; rrn_front: string; site_id: number }) =>
    api.post("/contracts/walk-in", data),
  sign: (contractId: number, data: { signature_data: string; signer_name: string; signer_rrn_front: string }) =>
    api.post(`/contracts/${contractId}/sign`, data),
  downloadPdf: (contractId: number) =>
    api.get(`/contracts/${contractId}/pdf`, { responseType: "blob" }),
};
