
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { PanelLeft, PanelRight } from 'lucide-react';

interface SplitWorkspaceProps {
  left: React.ReactNode;
  right: React.ReactNode;
  rightTitle?: string;
  storageKey?: string;
  header?: React.ReactNode;
}

const SplitWorkspace: React.FC<SplitWorkspaceProps> = ({ left, right, rightTitle, storageKey, header }) => {
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);

  useEffect(() => {
    if (storageKey) {
      const storedState = localStorage.getItem(storageKey);
      if (storedState) {
        setIsRightPanelCollapsed(JSON.parse(storedState));
      }
    }
  }, [storageKey]);

  const toggleRightPanel = () => {
    const newState = !isRightPanelCollapsed;
    setIsRightPanelCollapsed(newState);
    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(newState));
    }
  };

  return (
    <div className="h-dvh overflow-hidden flex flex-col">
      {header ? <div className="shrink-0 border-b border-border bg-background/80 backdrop-blur">{header}</div> : null}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-4">{left}</div>

        {!isRightPanelCollapsed ? (
          <div className="w-[420px] shrink-0 min-h-0 overflow-hidden border-l border-border/60 flex flex-col">
            <div className="p-3 border-b border-border/60">
              <div className="flex justify-between items-center gap-2">
                <h2 className="font-semibold text-sm">{rightTitle || 'Preview'}</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleRightPanel}
                  aria-label="Collapse simulator"
                >
                  <PanelRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="p-4 flex-1 min-h-0 overflow-y-auto">{right}</div>
          </div>
        ) : (
          <div className="w-12 border-l border-border/60 flex items-center justify-center">
            <Button
              onClick={toggleRightPanel}
              size="icon"
              variant="secondary"
              aria-label="Expand simulator"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SplitWorkspace;
