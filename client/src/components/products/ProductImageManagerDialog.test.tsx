import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { ProductImageManagerDialog } from './ProductImageManagerDialog';

jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn() }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => open ? <>{children}</> : null,
  DialogContent: ({ children }: any) => <div role="dialog">{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogHeader: ({ children }: any) => <header>{children}</header>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
jest.mock('@/components/media-picker', () => ({
  MediaPicker: ({ open, value, onChange, onOpenChange }: any) => open ? <button onClick={() => { onChange([...value, 'https://images.example.com/second.png']); onOpenChange(false); }}>Select library image</button> : null,
}));

const request = apiRequest as jest.Mock;
const first = '/objects/uploads/first';
let host: HTMLDivElement;
let root: Root;

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  request.mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

test('staff can select, preview, reorder the primary image, and save only thumbnails', async () => {
  const product = { id: 'product-a', name: 'ACM', thumbnailUrls: [first] } as any;
  const saved = jest.fn();
  request.mockImplementation(async (_method, _path, body) => ({ json: async () => ({ ...product, thumbnailUrls: body.thumbnailUrls }) }));
  await act(async () => root.render(<QueryClientProvider client={new QueryClient()}><ProductImageManagerDialog product={product} onClose={jest.fn()} onSaved={saved} /></QueryClientProvider>));
  expect(host.querySelector('img[alt="Product image 1, primary"]')).not.toBeNull();
  act(() => (Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Choose from media library')!).click());
  act(() => (Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select library image')!).click());
  expect(host.querySelectorAll('img[alt^="Product image"]')).toHaveLength(2);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Make image 2 primary"]')!.click());
  expect(host.querySelector<HTMLImageElement>('img[alt="Product image 1, primary"]')!.src).toContain('second.png');
  await act(async () => (Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Save images')!).click());
  expect(request).toHaveBeenCalledWith('PUT', '/api/products/product-a/thumbnails', { thumbnailUrls: ['https://images.example.com/second.png', first] });
  expect(saved).toHaveBeenCalledWith(expect.objectContaining({ thumbnailUrls: ['https://images.example.com/second.png', first] }));
});
