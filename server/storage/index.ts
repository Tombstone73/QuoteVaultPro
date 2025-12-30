/**
 * Storage Layer Index
 * 
 * This file instantiates all repository classes and re-exports their methods
 * as top-level named exports for backward compatibility with existing code.
 * 
 * All methods are bound to their repository instances to preserve `this` context.
 */

import { db } from "../db";
import { type InsertQuoteLineItem } from "@shared/schema";
import { AuditRepository } from "./audit.repo";
import { AccountingRepository } from "./accounting.repo";
import { InventoryRepository } from "./inventory.repo";
import { JobsRepository } from "./jobs.repo";
import { SharedRepository } from "./shared.repo";
import { CustomersRepository } from "./customers.repo";
import { QuotesRepository } from "./quotes.repo";
import { OrdersRepository } from "./orders.repo";
import { ImportRepository } from "./import.repo";

// Instantiate all repositories
const auditRepo = new AuditRepository(db);
const accountingRepo = new AccountingRepository(db);
const inventoryRepo = new InventoryRepository(db);
const jobsRepo = new JobsRepository(db);
const sharedRepo = new SharedRepository(db);
const customersRepo = new CustomersRepository(db);
const quotesRepo = new QuotesRepository(db);
const ordersRepo = new OrdersRepository(db);
const importRepo = new ImportRepository(db);

// =============================
// Audit Repository Exports
// =============================
export const createAuditLog = auditRepo.createAuditLog.bind(auditRepo);
export const getAuditLogs = auditRepo.getAuditLogs.bind(auditRepo);

// =============================
// Accounting Repository Exports (Vendors & Purchase Orders)
// =============================
export const getVendors = accountingRepo.getVendors.bind(accountingRepo);
export const getVendorById = accountingRepo.getVendorById.bind(accountingRepo);
export const createVendor = accountingRepo.createVendor.bind(accountingRepo);
export const updateVendor = accountingRepo.updateVendor.bind(accountingRepo);
export const deleteVendor = accountingRepo.deleteVendor.bind(accountingRepo);

export const getPurchaseOrders = accountingRepo.getPurchaseOrders.bind(accountingRepo);
export const getPurchaseOrderWithLines = accountingRepo.getPurchaseOrderWithLines.bind(accountingRepo);
export const createPurchaseOrder = accountingRepo.createPurchaseOrder.bind(accountingRepo);
export const updatePurchaseOrder = accountingRepo.updatePurchaseOrder.bind(accountingRepo);
export const deletePurchaseOrder = accountingRepo.deletePurchaseOrder.bind(accountingRepo);
export const sendPurchaseOrder = accountingRepo.sendPurchaseOrder.bind(accountingRepo);
export const receivePurchaseOrderLines = (organizationId: string, purchaseOrderId: string, items: any[], userId: string) => {
    return accountingRepo.receivePurchaseOrderLines(organizationId, purchaseOrderId, items, userId, inventoryRepo.adjustInventory.bind(inventoryRepo));
};

// =============================
// Inventory Repository Exports
// =============================
export const getAllMaterials = inventoryRepo.getAllMaterials.bind(inventoryRepo);
export const getMaterialById = inventoryRepo.getMaterialById.bind(inventoryRepo);
export const getMaterialBySku = inventoryRepo.getMaterialBySku.bind(inventoryRepo);
export const createMaterial = inventoryRepo.createMaterial.bind(inventoryRepo);
export const updateMaterial = inventoryRepo.updateMaterial.bind(inventoryRepo);
export const deleteMaterial = inventoryRepo.deleteMaterial.bind(inventoryRepo);
export const getMaterialLowStockAlerts = inventoryRepo.getMaterialLowStockAlerts.bind(inventoryRepo);

export const adjustInventory = inventoryRepo.adjustInventory.bind(inventoryRepo);
export const getInventoryAdjustments = inventoryRepo.getInventoryAdjustments.bind(inventoryRepo);

export const recordMaterialUsage = inventoryRepo.recordMaterialUsage.bind(inventoryRepo);
export const getMaterialUsageByOrder = inventoryRepo.getMaterialUsageByOrder.bind(inventoryRepo);
export const getMaterialUsageByLineItem = inventoryRepo.getMaterialUsageByLineItem.bind(inventoryRepo);
export const getMaterialUsageByMaterial = inventoryRepo.getMaterialUsageByMaterial.bind(inventoryRepo);
export const autoDeductInventoryWhenOrderMovesToProduction = inventoryRepo.autoDeductInventoryWhenOrderMovesToProduction.bind(inventoryRepo);

// =============================
// Jobs Repository Exports
// =============================
export const getJobs = jobsRepo.getJobs.bind(jobsRepo);
export const getJob = jobsRepo.getJob.bind(jobsRepo);
export const updateJob = jobsRepo.updateJob.bind(jobsRepo);
export const addJobNote = jobsRepo.addJobNote.bind(jobsRepo);
export const getJobsForOrder = jobsRepo.getJobsForOrder.bind(jobsRepo);

export const getJobStatuses = jobsRepo.getJobStatuses.bind(jobsRepo);
export const createJobStatus = jobsRepo.createJobStatus.bind(jobsRepo);
export const updateJobStatus = jobsRepo.updateJobStatus.bind(jobsRepo);
export const deleteJobStatus = jobsRepo.deleteJobStatus.bind(jobsRepo);

export const listJobFiles = jobsRepo.listJobFiles.bind(jobsRepo);
export const attachFileToJob = jobsRepo.attachFileToJob.bind(jobsRepo);
export const detachJobFile = jobsRepo.detachJobFile.bind(jobsRepo);

// =============================
// Shared Repository Exports (Users, Products, Settings, etc.)
// =============================
// User operations
export const getUser = sharedRepo.getUser.bind(sharedRepo);
export const getUserByEmail = sharedRepo.getUserByEmail.bind(sharedRepo);
export const getAllUsers = sharedRepo.getAllUsers.bind(sharedRepo);
export const updateUser = sharedRepo.updateUser.bind(sharedRepo);
export const deleteUser = sharedRepo.deleteUser.bind(sharedRepo);
export const upsertUser = sharedRepo.upsertUser.bind(sharedRepo);

// Product Type operations
export const getAllProductTypes = sharedRepo.getAllProductTypes.bind(sharedRepo);
export const getProductTypeById = sharedRepo.getProductTypeById.bind(sharedRepo);
export const createProductType = sharedRepo.createProductType.bind(sharedRepo);
export const updateProductType = sharedRepo.updateProductType.bind(sharedRepo);
export const deleteProductType = sharedRepo.deleteProductType.bind(sharedRepo);

// Product operations
export const getAllProducts = sharedRepo.getAllProducts.bind(sharedRepo);
export const getProductById = sharedRepo.getProductById.bind(sharedRepo);
export const createProduct = sharedRepo.createProduct.bind(sharedRepo);
export const updateProduct = sharedRepo.updateProduct.bind(sharedRepo);
export const deleteProduct = sharedRepo.deleteProduct.bind(sharedRepo);
export const cloneProduct = sharedRepo.cloneProduct.bind(sharedRepo);

// Product options operations
export const getProductOptions = sharedRepo.getProductOptions.bind(sharedRepo);
export const createProductOption = sharedRepo.createProductOption.bind(sharedRepo);
export const updateProductOption = sharedRepo.updateProductOption.bind(sharedRepo);
export const deleteProductOption = sharedRepo.deleteProductOption.bind(sharedRepo);

// Product variants operations
export const getProductVariants = sharedRepo.getProductVariants.bind(sharedRepo);
export const createProductVariant = sharedRepo.createProductVariant.bind(sharedRepo);
export const updateProductVariant = sharedRepo.updateProductVariant.bind(sharedRepo);
export const deleteProductVariant = sharedRepo.deleteProductVariant.bind(sharedRepo);

// Global variables operations
export const getAllGlobalVariables = sharedRepo.getAllGlobalVariables.bind(sharedRepo);
export const getGlobalVariableByName = sharedRepo.getGlobalVariableByName.bind(sharedRepo);
export const getGlobalVariableById = sharedRepo.getGlobalVariableById.bind(sharedRepo);
export const createGlobalVariable = sharedRepo.createGlobalVariable.bind(sharedRepo);
export const updateGlobalVariable = sharedRepo.updateGlobalVariable.bind(sharedRepo);
export const deleteGlobalVariable = sharedRepo.deleteGlobalVariable.bind(sharedRepo);

// Pricing Formulas operations
export const getPricingFormulas = sharedRepo.getPricingFormulas.bind(sharedRepo);
export const getPricingFormulaById = sharedRepo.getPricingFormulaById.bind(sharedRepo);
export const getPricingFormulaWithProducts = sharedRepo.getPricingFormulaWithProducts.bind(sharedRepo);
export const createPricingFormula = sharedRepo.createPricingFormula.bind(sharedRepo);
export const updatePricingFormula = sharedRepo.updatePricingFormula.bind(sharedRepo);
export const deletePricingFormula = sharedRepo.deletePricingFormula.bind(sharedRepo);

// Pricing rules operations
export const getAllPricingRules = sharedRepo.getAllPricingRules.bind(sharedRepo);
export const getPricingRuleByName = sharedRepo.getPricingRuleByName.bind(sharedRepo);
export const createPricingRule = sharedRepo.createPricingRule.bind(sharedRepo);
export const updatePricingRule = sharedRepo.updatePricingRule.bind(sharedRepo);

// Media assets operations
export const getAllMediaAssets = sharedRepo.getAllMediaAssets.bind(sharedRepo);
export const getMediaAssetById = sharedRepo.getMediaAssetById.bind(sharedRepo);
export const createMediaAsset = sharedRepo.createMediaAsset.bind(sharedRepo);
export const deleteMediaAsset = sharedRepo.deleteMediaAsset.bind(sharedRepo);

// Formula templates operations
export const getAllFormulaTemplates = sharedRepo.getAllFormulaTemplates.bind(sharedRepo);
export const getFormulaTemplateById = sharedRepo.getFormulaTemplateById.bind(sharedRepo);
export const createFormulaTemplate = sharedRepo.createFormulaTemplate.bind(sharedRepo);
export const updateFormulaTemplate = sharedRepo.updateFormulaTemplate.bind(sharedRepo);
export const deleteFormulaTemplate = sharedRepo.deleteFormulaTemplate.bind(sharedRepo);
export const getProductsByFormulaTemplate = sharedRepo.getProductsByFormulaTemplate.bind(sharedRepo);

// Email settings operations
export const getAllEmailSettings = sharedRepo.getAllEmailSettings.bind(sharedRepo);
export const getEmailSettingsById = sharedRepo.getEmailSettingsById.bind(sharedRepo);
export const getDefaultEmailSettings = sharedRepo.getDefaultEmailSettings.bind(sharedRepo);
export const createEmailSettings = sharedRepo.createEmailSettings.bind(sharedRepo);
export const updateEmailSettings = sharedRepo.updateEmailSettings.bind(sharedRepo);
export const deleteEmailSettings = sharedRepo.deleteEmailSettings.bind(sharedRepo);

// Company settings operations
export const getCompanySettings = sharedRepo.getCompanySettings.bind(sharedRepo);
export const createCompanySettings = sharedRepo.createCompanySettings.bind(sharedRepo);
export const updateCompanySettings = sharedRepo.updateCompanySettings.bind(sharedRepo);

// =============================
// Import Repository Exports
// =============================
export const createImportJob = importRepo.createJob.bind(importRepo);
export const addImportJobRows = importRepo.addJobRows.bind(importRepo);
export const getImportJob = importRepo.getJob.bind(importRepo);
export const listImportJobs = importRepo.listJobs.bind(importRepo);
export const listImportJobRows = importRepo.listJobRows.bind(importRepo);
export const updateImportJobStatus = importRepo.updateJobStatus.bind(importRepo);
export const markImportRowsApplied = importRepo.markRowsApplied.bind(importRepo);

// =============================
// Customers Repository Exports
// =============================
export const getAllCustomers = customersRepo.getAllCustomers.bind(customersRepo);
export const getCustomerById = customersRepo.getCustomerById.bind(customersRepo);
export const createCustomer = customersRepo.createCustomer.bind(customersRepo);
export const createCustomerWithPrimaryContact = customersRepo.createCustomerWithPrimaryContact.bind(customersRepo);
export const updateCustomer = customersRepo.updateCustomer.bind(customersRepo);
export const deleteCustomer = customersRepo.deleteCustomer.bind(customersRepo);

export const getCustomerContacts = customersRepo.getCustomerContacts.bind(customersRepo);
export const getCustomerContactById = customersRepo.getCustomerContactById.bind(customersRepo);
export const createCustomerContact = customersRepo.createCustomerContact.bind(customersRepo);
export const updateCustomerContact = customersRepo.updateCustomerContact.bind(customersRepo);
export const deleteCustomerContact = customersRepo.deleteCustomerContact.bind(customersRepo);

export const getCustomerNotes = customersRepo.getCustomerNotes.bind(customersRepo);
export const createCustomerNote = customersRepo.createCustomerNote.bind(customersRepo);
export const updateCustomerNote = customersRepo.updateCustomerNote.bind(customersRepo);
export const deleteCustomerNote = customersRepo.deleteCustomerNote.bind(customersRepo);

export const getCustomerCreditTransactions = customersRepo.getCustomerCreditTransactions.bind(customersRepo);
export const createCustomerCreditTransaction = customersRepo.createCustomerCreditTransaction.bind(customersRepo);
export const updateCustomerCreditTransaction = customersRepo.updateCustomerCreditTransaction.bind(customersRepo);
export const updateCustomerBalance = customersRepo.updateCustomerBalance.bind(customersRepo);

// Contacts (required by routes)
export const getAllContacts = customersRepo.getAllContacts.bind(customersRepo);
export const getContactWithRelations = customersRepo.getContactWithRelations.bind(customersRepo);

// =============================
// Quotes Repository Exports
// =============================
export const createQuote = quotesRepo.createQuote.bind(quotesRepo);
export const getQuoteById = quotesRepo.getQuoteById.bind(quotesRepo);
export const getMaxQuoteNumber = quotesRepo.getMaxQuoteNumber.bind(quotesRepo);
export const updateQuote = quotesRepo.updateQuote.bind(quotesRepo);
export const deleteQuote = quotesRepo.deleteQuote.bind(quotesRepo);

export const addLineItem = quotesRepo.addLineItem.bind(quotesRepo);
export const updateLineItem = quotesRepo.updateLineItem.bind(quotesRepo);
export const deleteLineItem = quotesRepo.deleteLineItem.bind(quotesRepo);
export const finalizeTemporaryLineItemsForUser = quotesRepo.finalizeTemporaryLineItemsForUser.bind(quotesRepo);

export const getUserQuotes = quotesRepo.getUserQuotes.bind(quotesRepo);
export const getUserQuotesPaginated = quotesRepo.getUserQuotesPaginated.bind(quotesRepo);
export const getAllQuotes = quotesRepo.getAllQuotes.bind(quotesRepo);
export const getQuotesForCustomer = quotesRepo.getQuotesForCustomer.bind(quotesRepo);

export const getQuoteWorkflowState = quotesRepo.getQuoteWorkflowState.bind(quotesRepo);
export const createQuoteWorkflowState = quotesRepo.createQuoteWorkflowState.bind(quotesRepo);
export const updateQuoteWorkflowState = quotesRepo.updateQuoteWorkflowState.bind(quotesRepo);

// =============================
// Orders Repository Exports
// =============================
export const getAllOrders = ordersRepo.getAllOrders.bind(ordersRepo);
export const getOrderById = ordersRepo.getOrderById.bind(ordersRepo);
export const createOrder = ordersRepo.createOrder.bind(ordersRepo);
export const updateOrder = ordersRepo.updateOrder.bind(ordersRepo);
export const deleteOrder = ordersRepo.deleteOrder.bind(ordersRepo);
export const convertQuoteToOrder = ordersRepo.convertQuoteToOrder.bind(ordersRepo);

export const getOrderLineItems = ordersRepo.getOrderLineItems.bind(ordersRepo);
export const getOrderLineItemById = ordersRepo.getOrderLineItemById.bind(ordersRepo);
export const createOrderLineItem = ordersRepo.createOrderLineItem.bind(ordersRepo);
export const updateOrderLineItem = ordersRepo.updateOrderLineItem.bind(ordersRepo);
export const deleteOrderLineItem = ordersRepo.deleteOrderLineItem.bind(ordersRepo);

export const getShipmentsByOrder = ordersRepo.getShipmentsByOrder.bind(ordersRepo);
export const getShipmentById = ordersRepo.getShipmentById.bind(ordersRepo);
export const createShipment = ordersRepo.createShipment.bind(ordersRepo);
export const updateShipment = ordersRepo.updateShipment.bind(ordersRepo);
export const deleteShipment = ordersRepo.deleteShipment.bind(ordersRepo);

export const getOrderAttachments = ordersRepo.getOrderAttachments.bind(ordersRepo);
export const createOrderAttachment = ordersRepo.createOrderAttachment.bind(ordersRepo);
export const updateOrderAttachment = ordersRepo.updateOrderAttachment.bind(ordersRepo);
export const deleteOrderAttachment = ordersRepo.deleteOrderAttachment.bind(ordersRepo);

export const listOrderFiles = ordersRepo.listOrderFiles.bind(ordersRepo);
export const attachFileToOrder = ordersRepo.attachFileToOrder.bind(ordersRepo);
export const updateOrderFileMeta = ordersRepo.updateOrderFileMeta.bind(ordersRepo);
export const detachOrderFile = ordersRepo.detachOrderFile.bind(ordersRepo);
export const getOrderArtworkSummary = ordersRepo.getOrderArtworkSummary.bind(ordersRepo);

export const getOrderAuditLog = ordersRepo.getOrderAuditLog.bind(ordersRepo);
export const createOrderAuditLog = ordersRepo.createOrderAuditLog.bind(ordersRepo);

// =============================
// Legacy compatibility: export a storage object
// =============================
export const storage = {
    // Audit
    createAuditLog,
    getAuditLogs,

    // Accounting
    getVendors,
    getVendorById,
    createVendor,
    updateVendor,
    deleteVendor,
    getPurchaseOrders,
    getPurchaseOrderWithLines,
    createPurchaseOrder,
    updatePurchaseOrder,
    deletePurchaseOrder,
    sendPurchaseOrder,
    receivePurchaseOrderLines,

    // Inventory
    getAllMaterials,
    getMaterialById,
    getMaterialBySku,
    createMaterial,
    updateMaterial,
    deleteMaterial,
    getMaterialLowStockAlerts,
    adjustInventory,
    getInventoryAdjustments,
    recordMaterialUsage,
    getMaterialUsageByOrder,
    getMaterialUsageByLineItem,
    getMaterialUsageByMaterial,
    autoDeductInventoryWhenOrderMovesToProduction,

    // Jobs
    getJobs,
    getJob,
    updateJob,
    addJobNote,
    getJobsForOrder,
    getJobStatuses,
    createJobStatus,
    updateJobStatus,
    deleteJobStatus,
    listJobFiles,
    attachFileToJob,
    detachJobFile,

    // Shared
    getUser,
    getUserByEmail,
    getAllUsers,
    updateUser,
    deleteUser,
    upsertUser,
    getAllProductTypes,
    getProductTypeById,
    createProductType,
    updateProductType,
    deleteProductType,
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    cloneProduct,
    getProductOptions,
    createProductOption,
    updateProductOption,
    deleteProductOption,
    getProductVariants,
    createProductVariant,
    updateProductVariant,
    deleteProductVariant,
    getAllGlobalVariables,
    getGlobalVariableByName,
    getGlobalVariableById,
    createGlobalVariable,
    updateGlobalVariable,
    deleteGlobalVariable,
    getPricingFormulas,
    getPricingFormulaById,
    getPricingFormulaWithProducts,
    createPricingFormula,
    updatePricingFormula,
    deletePricingFormula,
    getAllPricingRules,
    getPricingRuleByName,
    createPricingRule,
    updatePricingRule,
    getAllMediaAssets,
    getMediaAssetById,
    createMediaAsset,
    deleteMediaAsset,
    getAllFormulaTemplates,
    getFormulaTemplateById,
    createFormulaTemplate,
    updateFormulaTemplate,
    deleteFormulaTemplate,
    getProductsByFormulaTemplate,
    getAllEmailSettings,
    getEmailSettingsById,
    getDefaultEmailSettings,
    createEmailSettings,
    updateEmailSettings,
    deleteEmailSettings,
    getCompanySettings,
    createCompanySettings,
    updateCompanySettings,

    // Import Jobs
    createImportJob,
    addImportJobRows,
    getImportJob,
    listImportJobs,
    listImportJobRows,
    updateImportJobStatus,
    markImportRowsApplied,

    // Customers
    getAllCustomers,
    getCustomerById,
    createCustomer,
    createCustomerWithPrimaryContact,
    updateCustomer,
    deleteCustomer,
    getCustomerContacts,
    getCustomerContactById,
    createCustomerContact,
    updateCustomerContact,
    deleteCustomerContact,
    getCustomerNotes,
    createCustomerNote,
    updateCustomerNote,
    deleteCustomerNote,
    getCustomerCreditTransactions,
    createCustomerCreditTransaction,
    updateCustomerCreditTransaction,
    updateCustomerBalance,
    getAllContacts,
    getContactWithRelations,

    // Quotes
    createQuote,
    getQuoteById,
    getMaxQuoteNumber,
    updateQuote,
    deleteQuote,
    addLineItem,
    updateLineItem,
    deleteLineItem,
    createTemporaryLineItem: (
        organizationId: string,
        createdByUserId: string,
        lineItem: Omit<InsertQuoteLineItem, "quoteId">
    ) => quotesRepo.createTemporaryLineItem(organizationId, createdByUserId, lineItem),
    finalizeTemporaryLineItemsForUser: (
        organizationId: string,
        userId: string,
        quoteId: string
    ) => quotesRepo.finalizeTemporaryLineItemsForUser(organizationId, userId, quoteId),
    getUserQuotes,
    getUserQuotesPaginated,
    getAllQuotes,
    getQuotesForCustomer,
    getQuoteWorkflowState,
    createQuoteWorkflowState,
    updateQuoteWorkflowState,

    // Orders
    getAllOrders,
    getOrderById,
    createOrder,
    updateOrder,
    deleteOrder,
    convertQuoteToOrder,
    getOrderLineItems,
    getOrderLineItemById,
    createOrderLineItem,
    updateOrderLineItem,
    deleteOrderLineItem,
    getShipmentsByOrder,
    getShipmentById,
    createShipment,
    updateShipment,
    deleteShipment,
    getOrderAttachments,
    createOrderAttachment,
    updateOrderAttachment,
    deleteOrderAttachment,
    listOrderFiles,
    attachFileToOrder,
    updateOrderFileMeta,
    detachOrderFile,
    getOrderArtworkSummary,
    getOrderAuditLog,
    createOrderAuditLog,
};
