import { NotificationArea } from "@/components/layout/NotificationArea";
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { queryClient } from '@/lib/queryClient';
import { TooltipProvider } from '@/components/ui/tooltip';
import StaffProofingPage from '@/pages/StaffProofingPage';
import '../../client/src/index.css';

function Fixture() {
  const { setTheme } = useTheme();
  return <><div className="flex gap-4 bg-background p-2 text-foreground" aria-label="Synthetic fixture controls">
    <span>Synthetic files · mocked HTTP persistence</span>
    <button onClick={async () => { await fetch('/__fixture/missing'); await queryClient.invalidateQueries({ queryKey: ['/api/proofing/versions/file'] }); }}>Simulate missing file</button>
    <button onClick={() => fetch('/__fixture/restore')}>Restore source file</button>
    <button onClick={() => setTheme('light')}>Light theme</button><button onClick={() => setTheme('dark')}>Dark theme</button>
  </div><StaffProofingPage /><NotificationArea /></>;
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><QueryClientProvider client={queryClient}><TooltipProvider><BrowserRouter><Fixture /></BrowserRouter></TooltipProvider></QueryClientProvider></ThemeProvider>);
