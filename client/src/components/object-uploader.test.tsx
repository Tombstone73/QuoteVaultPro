import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ObjectUploader } from './object-uploader';

jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

let host: HTMLDivElement;
let root: Root;
const originalFetch = global.fetch;

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); global.fetch = originalFetch; });

test('uses the authorized upload response path and keeps object access behind the authenticated proxy', async () => {
  const uploadUrl = 'https://storage.example.com/upload?token=secret';
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === '/api/objects/upload') return { ok: true, json: async () => ({ storageTarget: 'supabase', method: 'PUT', url: uploadUrl, path: 'uploads/image-uuid' }) } as Response;
    if (input === uploadUrl && init?.method === 'PUT') return { ok: true } as Response;
    throw new Error(`Unexpected request: ${String(input)}`);
  });
  global.fetch = fetchMock as any;
  const onChange = jest.fn();
  const onUploaded = jest.fn(async () => {});
  await act(async () => root.render(<ObjectUploader value={[]} onChange={onChange} onUploaded={onUploaded} />));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(['image'], 'yard-sign.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(onUploaded).toHaveBeenCalledWith([{ url: '/objects/uploads/image-uuid', filename: 'yard-sign.png', fileSize: file.size, mimeType: 'image/png' }]);
  expect(onChange).toHaveBeenCalledWith(['/objects/uploads/image-uuid']);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/objects/upload');
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include' });
});

test('does not assign an upload when its provider lacks the customer image proxy', async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ storageTarget: 's3', method: 'PUT', url: 'https://storage.example.com/upload', path: 'org-a/image' }) } as Response));
  global.fetch = fetchMock as any;
  const onChange = jest.fn();
  const onUploaded = jest.fn();
  await act(async () => root.render(<ObjectUploader value={[]} onChange={onChange} onUploaded={onUploaded} />));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'sign.png', { type: 'image/png' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(onUploaded).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});
