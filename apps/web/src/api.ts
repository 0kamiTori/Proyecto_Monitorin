export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public mfaRequired = false,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  interactive = true,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(interactive ? { 'X-Smtel-Interactive': '1' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.details
        ? `${body.error} ${body.details.join(' · ')}`
        : body.error || 'Error de conexión.',
      body.mfaRequired,
    );
  return body as T;
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const mutate = <T>(path: string, method: string, body: unknown) =>
  api<T>(path, { method, body: JSON.stringify(body) });
export function downloadJson(filename: string, content: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadReport(path: string, filename: string) {
  const response = await fetch(`/api${path}`, { headers: { 'X-Smtel-Interactive': '1' } });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
