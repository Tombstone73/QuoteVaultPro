/**
 * PBV2 Product Builder V2 - Full-screen page
 * Provides a dedicated, non-constrained layout for the 3-column builder interface.
 * 
 * This is the primary route for editing PBV2 product trees with full viewport responsiveness.
 * Legacy V1 editor remains at /products/:productId/edit
 */

import { useParams } from 'react-router-dom';
import PBV2ProductBuilderSectionV2 from '@/components/PBV2ProductBuilderSectionV2';

export default function ProductBuilderV2Page() {
  const { productId } = useParams<{ productId: string }>();

  if (!productId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p>No product ID provided</p>
        </div>
      </div>
    );
  }

  // Full-screen builder with no constraints from parent layout
  return (
    <div className="w-full h-full">
      <PBV2ProductBuilderSectionV2 productId={productId} />
    </div>
  );
}
