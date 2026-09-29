import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthenticatedArtworkThumbnail } from './AuthenticatedArtworkThumbnail';
const mockGet = jest.fn();
jest.mock('@/lib/artworkAccess', () => ({ getArtworkObjectUrl: (...args: any[]) => mockGet(...args) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { mockGet.mockReset(); URL.revokeObjectURL=jest.fn(); host=document.createElement('div'); document.body.appendChild(host); root=createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render(status: string, error?: string, id='original') {
  await act(async () => root.render(<AuthenticatedArtworkThumbnail fileRecordId={id} fileName="art.ai" mimeType="application/octet-stream" previewStatus={status} previewError={error} alt="Station artwork" variant="preview" fallback={<div>No preview</div>} />));
}
test('shared Roll/Flatbed preview reads only derivative and cleans replacement object URLs', async () => {
  mockGet.mockResolvedValueOnce('blob:old').mockResolvedValueOnce('blob:new');
  await render('thumb_ready'); expect(mockGet).toHaveBeenCalledWith('original','preview');
  expect(host.querySelector('img')?.src).toBe('blob:old');
  await render('thumb_ready',undefined,'new-original');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old');
  expect(host.querySelector('img')?.src).toBe('blob:new');
});
test.each([
  ['thumb_pending',undefined,'Generating preview...'],
  ['thumb_failed','preview_unsupported_postscript','Preview unavailable'],
  ['thumb_failed','preview_render_failed','Preview generation failed'],
])('safe station fallback %s', async (status,error,text) => {
  mockGet.mockRejectedValue(new Error('Unavailable'));
  await render(status!,error);
  expect(host.textContent).toContain(text); expect(host.querySelector('img')).toBeNull();
});
test('shared Roll and Flatbed artwork fallback identifies EPS without requesting a derivative', async () => {
  await act(async () => root.render(<AuthenticatedArtworkThumbnail fileRecordId="eps-original" fileName="logo.eps" mimeType="application/octet-stream" previewStatus="uploaded" alt="Station artwork" variant="preview" fallback={<div>No preview</div>} />));
  expect(host.querySelector('[data-testid="eps-artwork-fallback"]')?.textContent).toContain('logo.eps');
  expect(host.textContent).toContain('EPS');
  expect(host.textContent).toContain('Preview unavailable');
  expect(host.querySelector('img')).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();
});
