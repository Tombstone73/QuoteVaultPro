import { MediaLibraryTab } from "@/components/admin-settings";
import { TitanCard } from "@/components/titan";

export default function MediaLibrarySettings() {
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">
            Media Library
          </h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Upload and manage images for products
          </p>
        </div>
        <div className="h-px bg-titan-border-subtle" />
        <MediaLibraryTab />
      </div>
    </TitanCard>
  );
}
