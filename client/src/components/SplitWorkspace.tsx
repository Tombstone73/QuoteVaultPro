
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
    <div className="min-w-0 bg-background">
      {header ? <div className="shrink-0 border-b border-border bg-background/80 backdrop-blur">{header}</div> : null}

      <div className="flex min-w-0 flex-col lg:flex-row">
        <div className="min-w-0 flex-1 p-4">{left}</div>

        {!isRightPanelCollapsed ? (
          <aside className="min-w-0 border-t border-border/60 lg:basis-[420px] lg:w-[420px] lg:max-w-[420px] lg:shrink-0 lg:self-start lg:border-l lg:border-t-0">
            <div className="p-3 border-b border-border/60 min-w-0">
              <div className="flex justify-between items-center gap-2 min-w-0">
                <h2 className="font-semibold text-sm min-w-0 truncate">{rightTitle || 'Preview'}</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={toggleRightPanel}
                  aria-label="Collapse simulator"
                >
                  <PanelRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="min-w-0">{right}</div>
          </aside>
        ) : (
          <div className="flex h-12 items-center justify-center border-t border-border/60 lg:h-auto lg:w-12 lg:border-l lg:border-t-0">
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
