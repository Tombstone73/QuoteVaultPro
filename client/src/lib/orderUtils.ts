/**
 * Order utility functions
 */

export interface OrderNumberDisplay {
  displayNumber: string;
  isTest: boolean;
}

/**
 * Get the display-friendly order number from an order object.
 * Handles test data and fallback scenarios gracefully.
 * 
 * @param order - Order object with id and orderNumber fields
 * @returns Object with displayNumber and isTest flag
 */
export function getDisplayOrderNumber(order: { id: string; orderNumber?: string | null }): OrderNumberDisplay {
  const orderNumber = order.orderNumber?.trim();
  
  // If no orderNumber exists, use short ID fallback
  if (!orderNumber) {
    return {
      displayNumber: `#${order.id.slice(0, 8)}`,
      isTest: false,
    };
  }
  
  // Check if this is a test order (TEST-TRANS pattern)
  const isTestOrder = /^TEST-TRANS-/i.test(orderNumber);
  
  if (isTestOrder) {
    // For test orders, show them as test data but use short ID for cleaner display
    return {
      displayNumber: `#${order.id.slice(0, 8)}`,
      isTest: true,
    };
  }
  
  // Normal case: display the actual order number
  return {
    displayNumber: orderNumber,
    isTest: false,
  };
}

/**
 * Format order number for display with optional test badge
 * 
 * @param order - Order object
 * @returns Formatted string for display
 */
export function formatOrderNumber(order: { id: string; orderNumber?: string | null }): string {
  const { displayNumber, isTest } = getDisplayOrderNumber(order);
  return isTest ? `${displayNumber} (Test)` : displayNumber;
}
