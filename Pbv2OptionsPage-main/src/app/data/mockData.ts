import type { Product } from '@/app/types';

export const mockProduct: Product = {
  id: 'prod-001',
  name: 'Business Cards - Premium',
  category: 'Business Cards',
  sku: 'BC-PREM-001',
  status: 'draft',
  fulfillment: 'shippable-estimate',
  basePrice: 45.00,
  weightModel: {
    mode: 'fixed',
    unit: 'lb',
    baseWeight: 0.5
  },
  optionGroups: [
    {
      id: 'group-paper',
      name: 'Paper Stock',
      description: 'Select the paper type and weight',
      sortOrder: 0,
      isRequired: true,
      isMultiSelect: false,
      options: [
        {
          id: 'opt-paper-14pt',
          name: '14pt Cardstock',
          description: 'Standard heavyweight cardstock',
          type: 'radio',
          sortOrder: 0,
          isDefault: true,
          isRequired: false,
          pricingBehavior: {
            type: 'none'
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: [],
          conditionalLogic: null
        },
        {
          id: 'opt-paper-16pt',
          name: '16pt Cardstock',
          description: 'Premium extra-thick cardstock',
          type: 'radio',
          sortOrder: 1,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'per-unit',
            perUnitAmount: 0.02
          },
          weightImpact: {
            enabled: true,
            type: 'fixed',
            value: 0.1
          },
          productionFlags: ['special-media'],
          conditionalLogic: null
        },
        {
          id: 'opt-paper-silk',
          name: 'Silk Laminated',
          description: 'Soft-touch silk finish with lamination',
          type: 'radio',
          sortOrder: 2,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'per-unit',
            perUnitAmount: 0.05
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: ['finishing-required', 'special-media'],
          conditionalLogic: null
        }
      ]
    },
    {
      id: 'group-coating',
      name: 'Coating & Finish',
      description: 'Add protective coatings or special finishes',
      sortOrder: 1,
      isRequired: false,
      isMultiSelect: false,
      options: [
        {
          id: 'opt-coat-none',
          name: 'No Coating',
          description: 'Uncoated matte finish',
          type: 'radio',
          sortOrder: 0,
          isDefault: true,
          isRequired: false,
          pricingBehavior: {
            type: 'none'
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: [],
          conditionalLogic: null
        },
        {
          id: 'opt-coat-gloss',
          name: 'Gloss UV',
          description: 'High-gloss UV coating on front',
          type: 'radio',
          sortOrder: 1,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'per-unit',
            perUnitAmount: 0.03
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: ['finishing-required'],
          conditionalLogic: {
            operator: 'and',
            conditions: [
              {
                targetOptionId: 'opt-paper-silk',
                operator: 'not-equals',
                value: 'selected'
              }
            ]
          }
        },
        {
          id: 'opt-coat-spot',
          name: 'Spot UV',
          description: 'Raised UV on specific areas (requires artwork)',
          type: 'radio',
          sortOrder: 2,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'flat',
            flatAmount: 85.00
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: ['finishing-required', 'proof-required'],
          conditionalLogic: {
            operator: 'and',
            conditions: [
              {
                targetOptionId: 'opt-paper-silk',
                operator: 'not-equals',
                value: 'selected'
              }
            ]
          }
        }
      ]
    },
    {
      id: 'group-printing',
      name: 'Print Sides',
      description: 'Choose single or double-sided printing',
      sortOrder: 2,
      isRequired: true,
      isMultiSelect: false,
      options: [
        {
          id: 'opt-print-single',
          name: 'Single-Sided',
          description: 'Front only',
          type: 'radio',
          sortOrder: 0,
          isDefault: true,
          isRequired: false,
          pricingBehavior: {
            type: 'none'
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: [],
          conditionalLogic: null
        },
        {
          id: 'opt-print-double',
          name: 'Double-Sided',
          description: 'Front and back',
          type: 'radio',
          sortOrder: 1,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'per-unit',
            perUnitAmount: 0.015
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: ['double-sided'],
          conditionalLogic: null
        }
      ]
    },
    {
      id: 'group-corners',
      name: 'Corner Options',
      description: 'Standard or custom corner treatments',
      sortOrder: 3,
      isRequired: false,
      isMultiSelect: false,
      options: [
        {
          id: 'opt-corner-square',
          name: 'Square Corners',
          description: 'Standard 90° corners',
          type: 'radio',
          sortOrder: 0,
          isDefault: true,
          isRequired: false,
          pricingBehavior: {
            type: 'none'
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: [],
          conditionalLogic: null
        },
        {
          id: 'opt-corner-rounded',
          name: 'Rounded Corners',
          description: '1/8" radius rounded corners',
          type: 'radio',
          sortOrder: 1,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'flat',
            flatAmount: 15.00
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: ['finishing-required'],
          conditionalLogic: null
        }
      ]
    },
    {
      id: 'group-special',
      name: 'Special Features',
      description: 'Premium add-ons and special effects',
      sortOrder: 4,
      isRequired: false,
      isMultiSelect: true,
      options: [
        {
          id: 'opt-special-foil',
          name: 'Foil Stamping',
          description: 'Metallic foil application (requires artwork)',
          type: 'checkbox',
          sortOrder: 0,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'flat',
            flatAmount: 125.00
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: ['finishing-required', 'proof-required', 'special-media'],
          conditionalLogic: {
            operator: 'and',
            conditions: [
              {
                targetOptionId: 'opt-coat-spot',
                operator: 'not-equals',
                value: 'selected'
              }
            ]
          }
        },
        {
          id: 'opt-special-emboss',
          name: 'Embossing',
          description: 'Raised impression (requires artwork)',
          type: 'checkbox',
          sortOrder: 1,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'flat',
            flatAmount: 95.00
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: ['finishing-required', 'proof-required'],
          conditionalLogic: null
        },
        {
          id: 'opt-special-edge',
          name: 'Edge Painting',
          description: 'Colored edge treatment',
          type: 'checkbox',
          sortOrder: 2,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'per-unit',
            perUnitAmount: 0.08
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: ['finishing-required'],
          conditionalLogic: {
            operator: 'and',
            conditions: [
              {
                targetOptionId: 'opt-paper-16pt',
                operator: 'equals',
                value: 'selected'
              }
            ]
          }
        }
      ]
    },
    {
      id: 'group-quantity',
      name: 'Quantity Tiers',
      description: 'Volume-based pricing',
      sortOrder: 5,
      isRequired: true,
      isMultiSelect: false,
      options: [
        {
          id: 'opt-qty-250',
          name: '250 cards',
          description: '',
          type: 'radio',
          sortOrder: 0,
          isDefault: true,
          isRequired: false,
          pricingBehavior: {
            type: 'none'
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: [],
          conditionalLogic: null
        },
        {
          id: 'opt-qty-500',
          name: '500 cards',
          description: '',
          type: 'radio',
          sortOrder: 1,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'flat',
            flatAmount: 25.00
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: [],
          conditionalLogic: null
        },
        {
          id: 'opt-qty-1000',
          name: '1,000 cards',
          description: '',
          type: 'radio',
          sortOrder: 2,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'flat',
            flatAmount: 45.00
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: [],
          conditionalLogic: null
        },
        {
          id: 'opt-qty-2500',
          name: '2,500 cards',
          description: '',
          type: 'radio',
          sortOrder: 3,
          isDefault: false,
          isRequired: false,
          pricingBehavior: {
            type: 'flat',
            flatAmount: 95.00
          },
          weightImpact: {
            enabled: false,
            type: 'fixed',
            value: 0
          },
          productionFlags: [],
          conditionalLogic: null
        }
      ]
    }
  ],
  validationRules: [
    {
      id: 'rule-001',
      type: 'conflict',
      message: 'Spot UV and Foil Stamping cannot be combined on the same job',
      affectedOptions: ['opt-coat-spot', 'opt-special-foil']
    },
    {
      id: 'rule-002',
      type: 'warning',
      message: 'Edge Painting is only available with 16pt cardstock',
      affectedOptions: ['opt-special-edge', 'opt-paper-16pt']
    },
    {
      id: 'rule-003',
      type: 'conflict',
      message: 'UV coating cannot be applied to Silk Laminated stock',
      affectedOptions: ['opt-coat-gloss', 'opt-coat-spot', 'opt-paper-silk']
    }
  ]
};
