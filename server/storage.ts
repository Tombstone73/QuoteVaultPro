import {
  users,
  products,
  productTypes,
  productOptions,
  productVariants,
  globalVariables,
  quotes,
  quoteLineItems,
  pricingRules,
  mediaAssets,
  formulaTemplates,
  emailSettings,
  companySettings,
  customers,
  customerContacts,
  customerNotes,
  customerCreditTransactions,
  orders,
  orderLineItems,
  jobs,
  jobNotes,
  jobStatusLog,
  type User,
  type UpsertUser,
  type Product,
  type InsertProduct,
  type UpdateProduct,
  type SelectProductType,
  type InsertProductType,
  type UpdateProductType,
  type ProductOption,
  type InsertProductOption,
  type UpdateProductOption,
  type ProductVariant,
  type InsertProductVariant,
  type UpdateProductVariant,
  type GlobalVariable,
  type InsertGlobalVariable,
  type UpdateGlobalVariable,
  type Quote,
  type InsertQuote,
  type UpdateQuote,
  type QuoteLineItem,
  type InsertQuoteLineItem,
  type QuoteWithRelations,
  type PricingRule,
  type InsertPricingRule,
  type UpdatePricingRule,
  type MediaAsset,
  type InsertMediaAsset,
  type FormulaTemplate,
  type InsertFormulaTemplate,
  type UpdateFormulaTemplate,
  type EmailSettings,
  type InsertEmailSettings,
  type UpdateEmailSettings,
  type CompanySettings,
  type InsertCompanySettings,
  type UpdateCompanySettings,
  type Customer,
  type InsertCustomer,
  type UpdateCustomer,
  type CustomerWithRelations,
  type CustomerContact,
  type InsertCustomerContact,
  type UpdateCustomerContact,
  type CustomerNote,
  type InsertCustomerNote,
  type UpdateCustomerNote,
  type CustomerCreditTransaction,
  type InsertCustomerCreditTransaction,
  type UpdateCustomerCreditTransaction,
  type Order,
  type InsertOrder,
  type UpdateOrder,
  type OrderWithRelations,
  type OrderLineItem,
  type InsertOrderLineItem,
  type UpdateOrderLineItem,
  type Job,
  type InsertJob,
  type UpdateJob,
  type JobNote,
  type InsertJobNote,
  type JobStatusLog,
  type InsertJobStatusLog,
  shipments,
  type Shipment,
  type InsertShipment,
  type UpdateShipment,
    materials,
    type Material,
    type InsertMaterial,
    type UpdateMaterial,
    inventoryAdjustments,
    type InventoryAdjustment,
    type InsertInventoryAdjustment,
    orderMaterialUsage,
    type OrderMaterialUsage,
    type InsertOrderMaterialUsage,
  auditLogs,
  type AuditLog,
  type InsertAuditLog,
  orderAuditLog,
  type OrderAuditLog,
  type InsertOrderAuditLog,
  orderAttachments,
  type OrderAttachment,
  type InsertOrderAttachment,
  type UpdateOrderAttachment,
  jobFiles,
  type JobFile,
  type InsertJobFile,
  quoteWorkflowStates,
  type QuoteWorkflowState,
  type InsertQuoteWorkflowState,
  jobStatuses,
  type JobStatus,
  type InsertJobStatus,
  type UpdateJobStatus,
  vendors,
  type Vendor,
  type InsertVendor,
  type UpdateVendor,
  purchaseOrders,
  purchaseOrderLineItems,
  type PurchaseOrder,
  type PurchaseOrderLineItem,
  type InsertPurchaseOrder,
  type UpdatePurchaseOrder,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, gte, lte, like, ilike, sql, desc, inArray } from "drizzle-orm";

export interface IStorage {
  // User operations (NOT tenant-scoped - users are global)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Product Type operations (tenant-scoped)
  getAllProductTypes(organizationId: string): Promise<SelectProductType[]>;
  getProductTypeById(organizationId: string, id: string): Promise<SelectProductType | undefined>;
  createProductType(organizationId: string, data: Omit<InsertProductType, 'organizationId'>): Promise<SelectProductType>;
  updateProductType(organizationId: string, id: string, data: Partial<Omit<InsertProductType, 'organizationId'>>): Promise<SelectProductType>;
  deleteProductType(organizationId: string, id: string): Promise<void>;

  // Product operations (tenant-scoped)
  getAllProducts(organizationId: string): Promise<Product[]>;
  getProductById(organizationId: string, id: string): Promise<Product | undefined>;
  createProduct(organizationId: string, product: Omit<InsertProduct, 'organizationId'>): Promise<Product>;
  updateProduct(organizationId: string, id: string, product: Omit<UpdateProduct, 'organizationId'>): Promise<Product>;
  deleteProduct(organizationId: string, id: string): Promise<void>;
  cloneProduct(organizationId: string, id: string): Promise<Product>;

  // Product options operations (tenant-scoped via productId)
  getProductOptions(productId: string): Promise<ProductOption[]>;
  createProductOption(option: InsertProductOption): Promise<ProductOption>;
  updateProductOption(id: string, option: Partial<InsertProductOption>): Promise<ProductOption>;
  deleteProductOption(id: string): Promise<void>;

  // Product variants operations (tenant-scoped via productId)
  getProductVariants(productId: string): Promise<ProductVariant[]>;
  createProductVariant(variant: InsertProductVariant): Promise<ProductVariant>;
  updateProductVariant(id: string, variant: Partial<InsertProductVariant>): Promise<ProductVariant>;
  deleteProductVariant(id: string): Promise<void>;

  // Global variables operations (tenant-scoped)
  getAllGlobalVariables(organizationId: string): Promise<GlobalVariable[]>;
  getGlobalVariableById(organizationId: string, id: string): Promise<GlobalVariable | undefined>;
  getGlobalVariableByName(organizationId: string, name: string): Promise<GlobalVariable | undefined>;
  createGlobalVariable(organizationId: string, variable: Omit<InsertGlobalVariable, 'organizationId'>): Promise<GlobalVariable>;
  updateGlobalVariable(organizationId: string, id: string, variable: Partial<Omit<InsertGlobalVariable, 'organizationId'>>): Promise<GlobalVariable>;
  deleteGlobalVariable(organizationId: string, id: string): Promise<void>;

  // Quote operations (tenant-scoped)
  createQuote(organizationId: string, data: {
    userId: string;
    customerName?: string;
    lineItems: Omit<InsertQuoteLineItem, 'quoteId'>[];
  }): Promise<QuoteWithRelations>;
  getQuoteById(organizationId: string, id: string, userId?: string): Promise<QuoteWithRelations | undefined>;
  getMaxQuoteNumber(organizationId: string): Promise<number | null>;
  updateQuote(organizationId: string, id: string, data: {
    customerName?: string;
    subtotal?: number;
    taxRate?: number;
    marginPercentage?: number;
    discountAmount?: number;
    totalPrice?: number;
  }): Promise<QuoteWithRelations>;
  deleteQuote(organizationId: string, id: string): Promise<void>;
  addLineItem(quoteId: string, lineItem: Omit<InsertQuoteLineItem, 'quoteId'>): Promise<QuoteLineItem>;
  updateLineItem(id: string, lineItem: Partial<InsertQuoteLineItem>): Promise<QuoteLineItem>;
  deleteLineItem(id: string): Promise<void>;
  getUserQuotes(organizationId: string, userId: string, filters?: {
    searchCustomer?: string;
    searchProduct?: string;
    startDate?: string;
    endDate?: string;
    minPrice?: string;
    maxPrice?: string;
  }): Promise<QuoteWithRelations[]>;
  getAllQuotes(organizationId: string, filters?: {
    searchUser?: string;
    searchCustomer?: string;
    searchProduct?: string;
    startDate?: string;
    endDate?: string;
    minQuantity?: string;
    maxQuantity?: string;
  }): Promise<QuoteWithRelations[]>;
  
  // Portal: Get quotes for a specific customer (used by customer portal)
  getQuotesForCustomer(organizationId: string, customerId: string, filters?: {
    source?: string;
  }): Promise<QuoteWithRelations[]>;

  // Pricing rules operations (tenant-scoped)
  getAllPricingRules(organizationId: string): Promise<PricingRule[]>;
  getPricingRuleByName(organizationId: string, name: string): Promise<PricingRule | undefined>;
  createPricingRule(organizationId: string, rule: InsertPricingRule): Promise<PricingRule>;
  updatePricingRule(organizationId: string, rule: UpdatePricingRule): Promise<PricingRule>;

  // Media assets operations (tenant-scoped)
  getAllMediaAssets(organizationId: string): Promise<MediaAsset[]>;
  getMediaAssetById(organizationId: string, id: string): Promise<MediaAsset | undefined>;
  createMediaAsset(organizationId: string, asset: Omit<InsertMediaAsset, 'organizationId'>): Promise<MediaAsset>;
  deleteMediaAsset(organizationId: string, id: string): Promise<void>;

  // Formula templates operations (tenant-scoped)
  getAllFormulaTemplates(organizationId: string): Promise<FormulaTemplate[]>;
  getFormulaTemplateById(organizationId: string, id: string): Promise<FormulaTemplate | undefined>;
  createFormulaTemplate(organizationId: string, template: Omit<InsertFormulaTemplate, 'organizationId'>): Promise<FormulaTemplate>;
  updateFormulaTemplate(organizationId: string, id: string, updates: Partial<Omit<FormulaTemplate, 'organizationId'>>): Promise<FormulaTemplate>;
  deleteFormulaTemplate(organizationId: string, id: string): Promise<void>;
  getProductsByFormulaTemplate(organizationId: string, templateId: string): Promise<Product[]>;

  // Email settings operations (tenant-scoped)
  getAllEmailSettings(organizationId: string): Promise<EmailSettings[]>;
  getEmailSettingsById(organizationId: string, id: string): Promise<EmailSettings | undefined>;
  getDefaultEmailSettings(organizationId: string): Promise<EmailSettings | undefined>;
  createEmailSettings(organizationId: string, settings: Omit<InsertEmailSettings, 'organizationId'>): Promise<EmailSettings>;
  updateEmailSettings(organizationId: string, id: string, settings: Partial<Omit<InsertEmailSettings, 'organizationId'>>): Promise<EmailSettings>;
  deleteEmailSettings(organizationId: string, id: string): Promise<void>;

  // Company settings operations (tenant-scoped)
  getCompanySettings(organizationId: string): Promise<CompanySettings | undefined>;
  createCompanySettings(organizationId: string, settings: Omit<InsertCompanySettings, 'organizationId'>): Promise<CompanySettings>;
  updateCompanySettings(organizationId: string, id: string, settings: Partial<Omit<InsertCompanySettings, 'organizationId'>>): Promise<CompanySettings>;

  // Customer operations (tenant-scoped)
  getAllCustomers(organizationId: string, filters?: {
    search?: string;
    status?: string;
    customerType?: string;
    assignedTo?: string;
  }): Promise<(Customer & { contacts?: CustomerContact[] })[]>;
  getCustomerById(organizationId: string, id: string): Promise<CustomerWithRelations | undefined>;
  createCustomer(organizationId: string, customer: Omit<InsertCustomer, 'organizationId'>): Promise<Customer>;
  updateCustomer(organizationId: string, id: string, customer: Partial<Omit<InsertCustomer, 'organizationId'>>): Promise<Customer>;
  deleteCustomer(organizationId: string, id: string): Promise<void>;
  createCustomerWithPrimaryContact(organizationId: string, data: {
    customer: Omit<InsertCustomer, 'organizationId'>;
    primaryContact?: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      title?: string;
      isPrimary?: boolean;
    } | null;
  }): Promise<{ customer: Customer; contact?: CustomerContact | null }>;

  // Customer contacts operations (tenant-scoped via customerId)
  getCustomerContacts(customerId: string): Promise<CustomerContact[]>;
  getCustomerContactById(id: string): Promise<CustomerContact | undefined>;
  createCustomerContact(contact: InsertCustomerContact): Promise<CustomerContact>;
  updateCustomerContact(id: string, contact: Partial<InsertCustomerContact>): Promise<CustomerContact>;
  deleteCustomerContact(id: string): Promise<void>;

  // Customer notes operations (tenant-scoped via customerId)
  getCustomerNotes(customerId: string, filters?: {
    noteType?: string;
    assignedTo?: string;
  }): Promise<CustomerNote[]>;
  createCustomerNote(note: InsertCustomerNote): Promise<CustomerNote>;
  updateCustomerNote(id: string, note: Partial<InsertCustomerNote>): Promise<CustomerNote>;
  deleteCustomerNote(id: string): Promise<void>;

  // Customer credit transactions operations (tenant-scoped via customerId)
  getCustomerCreditTransactions(customerId: string): Promise<CustomerCreditTransaction[]>;
  createCustomerCreditTransaction(transaction: InsertCustomerCreditTransaction): Promise<CustomerCreditTransaction>;
  updateCustomerCreditTransaction(id: string, transaction: Partial<InsertCustomerCreditTransaction>): Promise<CustomerCreditTransaction>;
  updateCustomerBalance(organizationId: string, customerId: string, amount: number, type: 'credit' | 'debit', reason: string, createdBy: string): Promise<Customer>;

  // Order operations (tenant-scoped)
  getAllOrders(organizationId: string, filters?: {
    search?: string;
    status?: string;
    priority?: string;
    customerId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Order[]>;
  getOrderById(organizationId: string, id: string): Promise<OrderWithRelations | undefined>;
  createOrder(organizationId: string, data: {
    customerId: string;
    contactId?: string | null;
    quoteId?: string | null;
    status?: string;
    priority?: string;
    dueDate?: Date | null;
    promisedDate?: Date | null;
    discount?: number;
    notesInternal?: string | null;
    createdByUserId: string;
    lineItems: Omit<InsertOrderLineItem, 'orderId'>[];
  }): Promise<OrderWithRelations>;
  updateOrder(organizationId: string, id: string, order: Partial<InsertOrder>): Promise<Order>;
  deleteOrder(organizationId: string, id: string): Promise<void>;
  convertQuoteToOrder(organizationId: string, quoteId: string, createdByUserId: string, options?: {
    dueDate?: Date;
    promisedDate?: Date;
    priority?: string;
    notesInternal?: Date;
  }): Promise<OrderWithRelations>;

  // Order line item operations (tenant-scoped via orderId)
  getOrderLineItems(orderId: string): Promise<OrderLineItem[]>;
  getOrderLineItemById(id: string): Promise<OrderLineItem | undefined>;
  createOrderLineItem(lineItem: InsertOrderLineItem): Promise<OrderLineItem>;
  updateOrderLineItem(id: string, lineItem: Partial<InsertOrderLineItem>): Promise<OrderLineItem>;
  deleteOrderLineItem(id: string): Promise<void>;

  // Shipment operations (tenant-scoped via orderId)
  getShipmentsByOrder(orderId: string): Promise<Shipment[]>;
  getShipmentById(id: string): Promise<Shipment | undefined>;
  createShipment(shipment: InsertShipment): Promise<Shipment>;
  updateShipment(id: string, shipment: Partial<InsertShipment>): Promise<Shipment>;
  deleteShipment(id: string): Promise<void>;

  // Inventory management operations (tenant-scoped)
  getAllMaterials(organizationId: string): Promise<Material[]>;
  getMaterialById(organizationId: string, id: string): Promise<Material | undefined>;
  getMaterialBySku(organizationId: string, sku: string): Promise<Material | undefined>;
  createMaterial(organizationId: string, material: Omit<InsertMaterial, 'organizationId'>): Promise<Material>;
  updateMaterial(organizationId: string, id: string, material: Partial<InsertMaterial>): Promise<Material>;
  deleteMaterial(organizationId: string, id: string): Promise<void>;
  getMaterialLowStockAlerts(organizationId: string): Promise<Material[]>;

  // Inventory adjustment operations (tenant-scoped via materialId)
  adjustInventory(
    organizationId: string,
    materialId: string,
    type: "manual_increase" | "manual_decrease" | "waste" | "shrinkage" | "job_usage" | "purchase_receipt",
    quantityChange: number,
    userId: string,
    reason?: string,
    orderId?: string
  ): Promise<InventoryAdjustment>;
  getInventoryAdjustments(materialId: string): Promise<InventoryAdjustment[]>;

  // Material usage operations (tenant-scoped via orderId)
  recordMaterialUsage(usage: InsertOrderMaterialUsage): Promise<OrderMaterialUsage>;
  getMaterialUsageByOrder(orderId: string): Promise<OrderMaterialUsage[]>;
  getMaterialUsageByLineItem(lineItemId: string): Promise<OrderMaterialUsage[]>;

  // Auto-deduction for production
  autoDeductInventoryWhenOrderMovesToProduction(organizationId: string, orderId: string, userId: string): Promise<void>;

  // Audit log operations (tenant-scoped)
  createAuditLog(organizationId: string, log: Omit<InsertAuditLog, 'organizationId'>): Promise<AuditLog>;
  getAuditLogs(organizationId: string, filters?: {
    userId?: string;
    actionType?: string;
    entityType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<AuditLog[]>;

  // Order audit log operations (tenant-scoped via orderId)
  getOrderAuditLog(orderId: string): Promise<OrderAuditLog[]>;
  createOrderAuditLog(log: InsertOrderAuditLog): Promise<OrderAuditLog>;

  // Order attachments operations
  getOrderAttachments(orderId: string): Promise<OrderAttachment[]>;
  createOrderAttachment(attachment: InsertOrderAttachment): Promise<OrderAttachment>;
  updateOrderAttachment(id: string, updates: UpdateOrderAttachment): Promise<OrderAttachment>;
  deleteOrderAttachment(id: string): Promise<void>;

  // Artwork & file handling operations
  listOrderFiles(orderId: string): Promise<(OrderAttachment & { uploadedByUser?: User | null })[]>;
  attachFileToOrder(data: InsertOrderAttachment): Promise<OrderAttachment>;
  updateOrderFileMeta(id: string, updates: UpdateOrderAttachment): Promise<OrderAttachment>;
  detachOrderFile(id: string): Promise<void>;
  getOrderArtworkSummary(orderId: string): Promise<{
    front?: OrderAttachment | null;
    back?: OrderAttachment | null;
    other: OrderAttachment[];
  }>;
  
  // Job file operations
  listJobFiles(jobId: string): Promise<(JobFile & { file?: OrderAttachment | null })[]>;
  attachFileToJob(data: InsertJobFile): Promise<JobFile>;
  detachJobFile(id: string): Promise<void>;

  // Quote workflow operations
  getQuoteWorkflowState(quoteId: string): Promise<QuoteWorkflowState | undefined>;
  createQuoteWorkflowState(state: InsertQuoteWorkflowState): Promise<QuoteWorkflowState>;
  updateQuoteWorkflowState(quoteId: string, updates: Partial<InsertQuoteWorkflowState>): Promise<QuoteWorkflowState>;

  // Contacts (required by routes) - tenant-scoped
  getAllContacts(organizationId: string, params: { search?: string; page?: number; pageSize?: number }): Promise<Array<CustomerContact & { companyName: string; ordersCount: number; quotesCount: number; lastActivityAt: Date | null }>>;
  getContactWithRelations(id: string): Promise<(CustomerContact & { customer?: Customer }) | undefined>;

  // Job operations (production workflow) - tenant-scoped
  getJobs(organizationId: string, filters?: { status?: string; assignedToUserId?: string; orderId?: string }): Promise<(Job & { order?: Order | null; orderLineItem?: OrderLineItem | null })[]>;
  getJob(organizationId: string, id: string): Promise<(Job & { order?: Order | null; orderLineItem?: OrderLineItem | null; notesLog?: JobNote[]; statusLog?: JobStatusLog[] }) | undefined>;
  updateJob(organizationId: string, id: string, data: Partial<InsertJob>, userId?: string): Promise<Job>;
  addJobNote(jobId: string, noteText: string, userId: string): Promise<JobNote>;
  getJobsForOrder(organizationId: string, orderId: string): Promise<Job[]>;

  // Vendor operations (tenant-scoped)
  getVendors(organizationId: string, filters?: { search?: string; isActive?: boolean; page?: number; pageSize?: number }): Promise<Vendor[]>;
  getVendorById(organizationId: string, id: string): Promise<Vendor | undefined>;
  createVendor(organizationId: string, data: Omit<InsertVendor, 'organizationId'>): Promise<Vendor>;
  updateVendor(organizationId: string, id: string, data: Partial<Omit<InsertVendor, 'organizationId'>>): Promise<Vendor>;
  deleteVendor(organizationId: string, id: string): Promise<void>;

  // Purchase Order operations (tenant-scoped)
  getPurchaseOrders(organizationId: string, filters?: { vendorId?: string; status?: string; search?: string; startDate?: string; endDate?: string }): Promise<PurchaseOrder[]>;
  getPurchaseOrderWithLines(organizationId: string, id: string): Promise<(PurchaseOrder & { vendor?: Vendor | null; lineItems: PurchaseOrderLineItem[] }) | undefined>;
  createPurchaseOrder(organizationId: string, data: Omit<InsertPurchaseOrder, 'organizationId'> & { createdByUserId: string }): Promise<PurchaseOrder & { lineItems: PurchaseOrderLineItem[] }>;
  updatePurchaseOrder(organizationId: string, id: string, data: UpdatePurchaseOrder): Promise<PurchaseOrder & { lineItems: PurchaseOrderLineItem[] }>;
  deletePurchaseOrder(organizationId: string, id: string): Promise<void>;
  sendPurchaseOrder(organizationId: string, id: string): Promise<PurchaseOrder>;
  receivePurchaseOrderLines(organizationId: string, purchaseOrderId: string, items: { lineItemId: string; quantityToReceive: number; receivedDate?: Date }[], userId: string): Promise<PurchaseOrder & { lineItems: PurchaseOrderLineItem[] }>;

  // Job Status Configuration (tenant-scoped)
  getJobStatuses(organizationId: string): Promise<JobStatus[]>;
  createJobStatus(organizationId: string, data: Omit<InsertJobStatus, 'organizationId'>): Promise<JobStatus>;
  updateJobStatus(organizationId: string, id: string, data: Partial<Omit<InsertJobStatus, 'organizationId'>>): Promise<JobStatus>;
  deleteJobStatus(organizationId: string, id: string): Promise<void>;

  // Material/Inventory operations (tenant-scoped)
  getAllMaterials(organizationId: string): Promise<Material[]>;
  getMaterialById(organizationId: string, id: string): Promise<Material | undefined>;
  getMaterialBySku(organizationId: string, sku: string): Promise<Material | undefined>;
  createMaterial(organizationId: string, material: Omit<InsertMaterial, 'organizationId'>): Promise<Material>;
  updateMaterial(organizationId: string, id: string, materialData: Partial<InsertMaterial>): Promise<Material>;
  deleteMaterial(organizationId: string, id: string): Promise<void>;
  getMaterialLowStockAlerts(organizationId: string): Promise<Material[]>;
  adjustInventory(organizationId: string, materialId: string, type: "manual_increase" | "manual_decrease" | "waste" | "shrinkage" | "job_usage" | "purchase_receipt", quantityChange: number, userId: string, reason?: string, orderId?: string): Promise<InventoryAdjustment>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(users.email);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };

    const [user] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // Try to insert, and if there's a conflict on either id or email, update the user
    try {
      const updateFields: any = {
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profileImageUrl: userData.profileImageUrl,
        updatedAt: new Date(),
      };

      // Only include isAdmin if it's explicitly provided
      if (userData.isAdmin !== undefined) {
        updateFields.isAdmin = userData.isAdmin;
      }

      // Only include role if it's explicitly provided
      if (userData.role !== undefined) {
        updateFields.role = userData.role;
      }

      const [user] = await db
        .insert(users)
        .values(userData)
        .onConflictDoUpdate({
          target: users.id,
          set: updateFields,
        })
        .returning();
      return user;
    } catch (error: any) {
      // If we get a unique constraint violation on email, find and update that user
      if (error?.code === '23505' && error?.constraint === 'users_email_unique') {
        const [existingUser] = await db
          .select()
          .from(users)
          .where(sql`${users.email} = ${userData.email}`);

        if (existingUser) {
          // Update the existing user's profile, keep their original id
          const updateFields: any = {
            firstName: userData.firstName,
            lastName: userData.lastName,
            profileImageUrl: userData.profileImageUrl,
            updatedAt: new Date(),
          };

          // Only include isAdmin if it's explicitly provided
          if (userData.isAdmin !== undefined) {
            updateFields.isAdmin = userData.isAdmin;
          }

          // Only include role if it's explicitly provided
          if (userData.role !== undefined) {
            updateFields.role = userData.role;
          }
          
          const [updatedUser] = await db
            .update(users)
            .set(updateFields)
            .where(eq(users.id, existingUser.id))
            .returning();
          return updatedUser;
        }
      }
      // Re-throw if it's a different error
      throw error;
    }
  }

  // Product Type operations (tenant-scoped)
  async getAllProductTypes(organizationId: string): Promise<SelectProductType[]> {
    return await db.select().from(productTypes)
      .where(eq(productTypes.organizationId, organizationId))
      .orderBy(productTypes.sortOrder, productTypes.name);
  }

  async getProductTypeById(organizationId: string, id: string): Promise<SelectProductType | undefined> {
    const [type] = await db.select().from(productTypes)
      .where(and(eq(productTypes.id, id), eq(productTypes.organizationId, organizationId)));
    return type;
  }

  async createProductType(organizationId: string, data: Omit<InsertProductType, 'organizationId'>): Promise<SelectProductType> {
    const [newType] = await db
      .insert(productTypes)
      .values({
        ...data,
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return newType;
  }

  async updateProductType(organizationId: string, id: string, data: Partial<Omit<InsertProductType, 'organizationId'>>): Promise<SelectProductType> {
    const [updated] = await db
      .update(productTypes)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(productTypes.id, id), eq(productTypes.organizationId, organizationId)))
      .returning();
    
    if (!updated) {
      throw new Error("Product type not found");
    }
    return updated;
  }

  async deleteProductType(organizationId: string, id: string): Promise<void> {
    await db.delete(productTypes).where(and(eq(productTypes.id, id), eq(productTypes.organizationId, organizationId)));
  }

  // Product operations (tenant-scoped)
  async getAllProducts(organizationId: string): Promise<Product[]> {
    return await db.select().from(products)
      .where(eq(products.organizationId, organizationId))
      .orderBy(products.name);
  }

  async getProductById(organizationId: string, id: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products)
      .where(and(eq(products.id, id), eq(products.organizationId, organizationId)));
    return product;
  }

  async createProduct(organizationId: string, product: Omit<InsertProduct, 'organizationId'>): Promise<Product> {
    const cleanProduct: any = { organizationId };
    Object.entries(product).forEach(([k, v]) => {
      if (k === 'variantLabel' && v === null) {
        // Omit null variantLabel so DB default applies
        return;
      }
      cleanProduct[k] = v;
    });
    const [newProduct] = await db.insert(products).values(cleanProduct).returning();
    return newProduct;
  }

  async updateProduct(organizationId: string, id: string, productData: Omit<UpdateProduct, 'organizationId'>): Promise<Product> {
    const cleanProductData: any = { updatedAt: new Date() };
    Object.entries(productData).forEach(([k, v]) => {
      if (k === 'variantLabel' && v === null) {
        // Reset to default value when null
        cleanProductData[k] = 'Variant';
        return;
      }
      cleanProductData[k] = v;
    });
    const [updated] = await db
      .update(products)
      .set(cleanProductData)
      .where(and(eq(products.id, id), eq(products.organizationId, organizationId)))
      .returning();
    return updated;
  }

  async deleteProduct(organizationId: string, id: string): Promise<void> {
    await db.delete(products).where(and(eq(products.id, id), eq(products.organizationId, organizationId)));
  }

  async cloneProduct(organizationId: string, id: string): Promise<Product> {
    const originalProduct = await this.getProductById(organizationId, id);
    if (!originalProduct) {
      throw new Error('Product not found');
    }

    const newProductData: Omit<InsertProduct, 'organizationId'> = {
      name: `${originalProduct.name} (Copy)`,
      description: originalProduct.description,
      requiresProductionJob: originalProduct.requiresProductionJob,
      productTypeId: originalProduct.productTypeId,
      pricingFormula: originalProduct.pricingFormula,
      variantLabel: originalProduct.variantLabel,
      category: originalProduct.category,
      storeUrl: originalProduct.storeUrl,
      showStoreLink: originalProduct.showStoreLink,
      isActive: originalProduct.isActive,
    };

    const newProduct = await this.createProduct(organizationId, newProductData);

    const originalVariants = await this.getProductVariants(id);
    for (const variant of originalVariants) {
      await this.createProductVariant({
        productId: newProduct.id,
        name: variant.name,
        description: variant.description || undefined,
        basePricePerSqft: parseFloat(variant.basePricePerSqft),
        isDefault: variant.isDefault,
        displayOrder: variant.displayOrder,
        isActive: variant.isActive,
      });
    }

    const originalOptions = await this.getProductOptions(id);
    
    const optionIdMap: Record<string, string> = {};
    
    const parentOptions = originalOptions.filter(opt => !opt.parentOptionId);
    for (const option of parentOptions) {
      const newOption = await this.createProductOption({
        productId: newProduct.id,
        name: option.name,
        description: option.description || undefined,
        type: option.type,
        defaultValue: option.defaultValue || undefined,
        defaultSelection: option.defaultSelection || undefined,
        isDefaultEnabled: option.isDefaultEnabled,
        setupCost: parseFloat(option.setupCost),
        priceFormula: option.priceFormula || undefined,
        parentOptionId: undefined,
        displayOrder: option.displayOrder,
        isActive: option.isActive,
      });
      optionIdMap[option.id] = newOption.id;
    }

    const childOptions = originalOptions.filter(opt => opt.parentOptionId);
    for (const option of childOptions) {
      const newParentId = option.parentOptionId ? optionIdMap[option.parentOptionId] : undefined;
      const newOption = await this.createProductOption({
        productId: newProduct.id,
        name: option.name,
        description: option.description || undefined,
        type: option.type,
        defaultValue: option.defaultValue || undefined,
        defaultSelection: option.defaultSelection || undefined,
        isDefaultEnabled: option.isDefaultEnabled,
        setupCost: parseFloat(option.setupCost),
        priceFormula: option.priceFormula || undefined,
        parentOptionId: newParentId,
        displayOrder: option.displayOrder,
        isActive: option.isActive,
      });
      optionIdMap[option.id] = newOption.id;
    }

    return newProduct;
  }

  // Product options operations
  async getProductOptions(productId: string): Promise<ProductOption[]> {
    return await db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, productId))
      .orderBy(productOptions.displayOrder);
  }

  async createProductOption(option: InsertProductOption): Promise<ProductOption> {
    const optionData = {
      ...option,
      setupCost: option.setupCost.toString(),
    } as typeof productOptions.$inferInsert;
    
    const [newOption] = await db.insert(productOptions).values(optionData).returning();
    return newOption;
  }

  async updateProductOption(id: string, optionData: Partial<InsertProductOption>): Promise<ProductOption> {
    const updateData: Record<string, any> = {
      ...optionData,
      updatedAt: new Date(),
    };
    
    if (optionData.setupCost !== undefined) {
      updateData.setupCost = optionData.setupCost.toString();
    }
    
    const [updated] = await db
      .update(productOptions)
      .set(updateData)
      .where(eq(productOptions.id, id))
      .returning();
    return updated;
  }

  async deleteProductOption(id: string): Promise<void> {
    await db.delete(productOptions).where(eq(productOptions.id, id));
  }

  // Product variants operations
  async getProductVariants(productId: string): Promise<ProductVariant[]> {
    return await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(productVariants.displayOrder);
  }

  async createProductVariant(variant: InsertProductVariant): Promise<ProductVariant> {
    const variantData = {
      ...variant,
      basePricePerSqft: variant.basePricePerSqft.toString(),
    } as typeof productVariants.$inferInsert;
    
    const [newVariant] = await db.insert(productVariants).values(variantData).returning();
    return newVariant;
  }

  async updateProductVariant(id: string, variantData: Partial<InsertProductVariant>): Promise<ProductVariant> {
    const updateData: Record<string, any> = {
      ...variantData,
      updatedAt: new Date(),
    };
    
    if (variantData.basePricePerSqft !== undefined) {
      updateData.basePricePerSqft = variantData.basePricePerSqft.toString();
    }
    
    const [updated] = await db
      .update(productVariants)
      .set(updateData)
      .where(eq(productVariants.id, id))
      .returning();
    return updated;
  }

  async deleteProductVariant(id: string): Promise<void> {
    await db.delete(productVariants).where(eq(productVariants.id, id));
  }

  // Global variables operations (tenant-scoped)
  async getAllGlobalVariables(organizationId: string): Promise<GlobalVariable[]> {
    return await db
      .select()
      .from(globalVariables)
      .where(and(eq(globalVariables.organizationId, organizationId), eq(globalVariables.isActive, true)))
      .orderBy(globalVariables.category, globalVariables.name);
  }

  async getGlobalVariableByName(organizationId: string, name: string): Promise<GlobalVariable | undefined> {
    const [variable] = await db
      .select()
      .from(globalVariables)
      .where(and(eq(globalVariables.name, name), eq(globalVariables.organizationId, organizationId)));
    return variable;
  }

  async getGlobalVariableById(organizationId: string, id: string): Promise<GlobalVariable | undefined> {
    const [variable] = await db
      .select()
      .from(globalVariables)
      .where(and(eq(globalVariables.id, id), eq(globalVariables.organizationId, organizationId)));
    return variable;
  }

  async createGlobalVariable(organizationId: string, variable: Omit<InsertGlobalVariable, 'organizationId'>): Promise<GlobalVariable> {
    const variableData = {
      ...variable,
      organizationId,
      value: variable.value.toString(),
    } as typeof globalVariables.$inferInsert;
    
    const [newVariable] = await db.insert(globalVariables).values(variableData).returning();
    return newVariable;
  }

  async updateGlobalVariable(organizationId: string, id: string, variableData: Partial<Omit<InsertGlobalVariable, 'organizationId'>>): Promise<GlobalVariable> {
    const updateData: Record<string, any> = {
      ...variableData,
      updatedAt: new Date(),
    };
    
    if (variableData.value !== undefined) {
      updateData.value = variableData.value.toString();
    }
    
    const [updated] = await db
      .update(globalVariables)
      .set(updateData)
      .where(and(eq(globalVariables.id, id), eq(globalVariables.organizationId, organizationId)))
      .returning();
    return updated;
  }

  async deleteGlobalVariable(organizationId: string, id: string): Promise<void> {
    await db.delete(globalVariables).where(and(eq(globalVariables.id, id), eq(globalVariables.organizationId, organizationId)));
  }

  // Quote operations (tenant-scoped)
  async createQuote(organizationId: string, data: {
    userId: string;
    customerId?: string;
    contactId?: string;
    customerName?: string;
    source?: string;
    lineItems: Omit<InsertQuoteLineItem, 'quoteId'>[];
  }): Promise<QuoteWithRelations> {
    // Calculate subtotal from line items
    const subtotal = data.lineItems.reduce((sum, item) => sum + Number(item.linePrice), 0);
    
    // Use a transaction with row-level locking to ensure atomic quote number assignment
    const newQuote = await db.transaction(async (tx) => {
      // Lock the row to prevent concurrent access - use raw SQL for SELECT FOR UPDATE
      const result = await tx.execute(sql`
        SELECT * FROM ${globalVariables}
        WHERE ${globalVariables.name} = 'next_quote_number'
        AND ${globalVariables.organizationId} = ${organizationId}
        FOR UPDATE
      `);
      
      const quoteNumberVar = result.rows[0] as any;
      
      if (!quoteNumberVar) {
        throw new Error('Quote numbering system not initialized');
      }
      
      const quoteNumber = Math.floor(Number(quoteNumberVar.value));
      
      // Create the parent quote (totalPrice initially same as subtotal, can be adjusted later)
      const quoteData = {
        userId: data.userId,
        quoteNumber,
        organizationId,
        customerId: data.customerId || null,
        contactId: data.contactId || null,
        customerName: data.customerName,
        source: data.source || 'internal',
        subtotal: subtotal.toString(),
        totalPrice: subtotal.toString(),
      } as typeof quotes.$inferInsert;
      
      const [quote] = await tx.insert(quotes).values(quoteData).returning();
      
      // Increment the next quote number
      await tx
        .update(globalVariables)
        .set({ 
          value: (quoteNumber + 1).toString(),
          updatedAt: new Date(),
        })
        .where(eq(globalVariables.id, quoteNumberVar.id));
      
      return quote;
    });
    
    // Create line items
    const lineItemsData = data.lineItems.map((item, index) => ({
      quoteId: newQuote.id,
      productId: item.productId,
      productName: item.productName,
      variantId: item.variantId,
      variantName: item.variantName,
      productType: (item as any).productType || 'wide_roll',
      width: item.width.toString(),
      height: item.height.toString(),
      quantity: item.quantity,
      specsJson: (item as any).specsJson || null,
      selectedOptions: item.selectedOptions as Array<{
        optionId: string;
        optionName: string;
        value: string | number | boolean;
        setupCost: number;
        calculatedCost: number;
      }>,
      linePrice: item.linePrice.toString(),
      priceBreakdown: {
        ...item.priceBreakdown,
        variantInfo: item.priceBreakdown.variantInfo as string | undefined,
      },
      displayOrder: item.displayOrder || index,
    }));
    
    const createdLineItems = await db.insert(quoteLineItems).values(lineItemsData).returning();
    
    // Fetch user and product details for line items
    const lineItemsWithRelations = await Promise.all(
      createdLineItems.map(async (lineItem) => {
        const [product] = await db.select().from(products).where(eq(products.id, lineItem.productId));
        let variant = null;
        if (lineItem.variantId) {
          [variant] = await db.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
        }
        return {
          ...lineItem,
          product,
          variant,
        };
      })
    );
    
    const [user] = await db.select().from(users).where(eq(users.id, newQuote.userId));
    
    return {
      ...newQuote,
      user,
      lineItems: lineItemsWithRelations,
    };
  }

  async getQuoteById(organizationId: string, id: string, userId?: string): Promise<QuoteWithRelations | undefined> {
    const conditions = [eq(quotes.id, id), eq(quotes.organizationId, organizationId)];
    if (userId) {
      conditions.push(eq(quotes.userId, userId));
    }

    const [quote] = await db
      .select()
      .from(quotes)
      .where(and(...conditions));

    if (!quote) {
      return undefined;
    }

    const lineItems = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteId, id));

    // Fetch product and variant details for line items
    const lineItemsWithRelations = await Promise.all(
      lineItems.map(async (lineItem) => {
        const [product] = await db.select().from(products).where(eq(products.id, lineItem.productId));
        let variant = null;
        if (lineItem.variantId) {
          [variant] = await db.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
        }
        return {
          ...lineItem,
          product,
          variant,
        };
      })
    );

    const [user] = await db.select().from(users).where(eq(users.id, quote.userId));

    return {
      ...quote,
      user,
      lineItems: lineItemsWithRelations,
    };
  }

  async getMaxQuoteNumber(organizationId: string): Promise<number | null> {
    const result = await db
      .select({ maxNumber: sql<number>`MAX(${quotes.quoteNumber})` })
      .from(quotes)
      .where(eq(quotes.organizationId, organizationId));
    
    return result[0]?.maxNumber ?? null;
  }

  async updateQuote(organizationId: string, id: string, data: {
    customerName?: string;
    subtotal?: number;
    taxRate?: number;
    marginPercentage?: number;
    discountAmount?: number;
    totalPrice?: number;
  }): Promise<QuoteWithRelations> {
    const updateData: any = {};
    if (data.customerName !== undefined) updateData.customerName = data.customerName;
    if (data.subtotal !== undefined) updateData.subtotal = data.subtotal.toString();
    if (data.taxRate !== undefined) updateData.taxRate = data.taxRate.toString();
    if (data.marginPercentage !== undefined) updateData.marginPercentage = data.marginPercentage.toString();
    if (data.discountAmount !== undefined) updateData.discountAmount = data.discountAmount.toString();
    if (data.totalPrice !== undefined) updateData.totalPrice = data.totalPrice.toString();

    console.log(`[updateQuote] ID: ${id}, updateData:`, updateData);

    const [updated] = await db
      .update(quotes)
      .set(updateData)
      .where(and(eq(quotes.id, id), eq(quotes.organizationId, organizationId)))
      .returning();

    console.log(`[updateQuote] Updated row:`, updated);

    if (!updated) {
      throw new Error(`Quote ${id} not found`);
    }

    // Fetch the complete quote with relations
    const result = await this.getQuoteById(organizationId, id);
    console.log(`[updateQuote] Fetched result customerName:`, result?.customerName);
    if (!result) {
      throw new Error(`Quote ${id} not found after update`);
    }
    return result;
  }

  async deleteQuote(organizationId: string, id: string): Promise<void> {
    await db.delete(quotes).where(and(eq(quotes.id, id), eq(quotes.organizationId, organizationId)));
  }

  async addLineItem(quoteId: string, lineItem: Omit<InsertQuoteLineItem, 'quoteId'>): Promise<QuoteLineItem> {
    const lineItemData = {
      quoteId,
      productId: lineItem.productId,
      productName: lineItem.productName,
      variantId: lineItem.variantId,
      variantName: lineItem.variantName,
      productType: (lineItem as any).productType || 'wide_roll',
      width: lineItem.width.toString(),
      height: lineItem.height.toString(),
      quantity: lineItem.quantity,
      specsJson: (lineItem as any).specsJson || null,
      selectedOptions: lineItem.selectedOptions as Array<{
        optionId: string;
        optionName: string;
        value: string | number | boolean;
        setupCost: number;
        calculatedCost: number;
      }>,
      linePrice: lineItem.linePrice.toString(),
      priceBreakdown: {
        ...lineItem.priceBreakdown,
        variantInfo: lineItem.priceBreakdown.variantInfo as string | undefined,
      },
      displayOrder: lineItem.displayOrder || 0,
    };

    const [created] = await db.insert(quoteLineItems).values(lineItemData).returning();
    return created;
  }

  async updateLineItem(id: string, lineItem: Partial<InsertQuoteLineItem>): Promise<QuoteLineItem> {
    const updateData: any = {};
    if (lineItem.productId !== undefined) updateData.productId = lineItem.productId;
    if (lineItem.productName !== undefined) updateData.productName = lineItem.productName;
    if (lineItem.variantId !== undefined) updateData.variantId = lineItem.variantId;
    if (lineItem.variantName !== undefined) updateData.variantName = lineItem.variantName;
    if (lineItem.width !== undefined) updateData.width = lineItem.width.toString();
    if (lineItem.height !== undefined) updateData.height = lineItem.height.toString();
    if (lineItem.quantity !== undefined) updateData.quantity = lineItem.quantity;
    if (lineItem.selectedOptions !== undefined) updateData.selectedOptions = lineItem.selectedOptions;
    if (lineItem.linePrice !== undefined) updateData.linePrice = lineItem.linePrice.toString();
    if (lineItem.priceBreakdown !== undefined) updateData.priceBreakdown = lineItem.priceBreakdown;
    if (lineItem.displayOrder !== undefined) updateData.displayOrder = lineItem.displayOrder;

    const [updated] = await db
      .update(quoteLineItems)
      .set(updateData)
      .where(eq(quoteLineItems.id, id))
      .returning();

    if (!updated) {
      throw new Error(`Line item ${id} not found`);
    }

    return updated;
  }

  async deleteLineItem(id: string): Promise<void> {
    await db.delete(quoteLineItems).where(eq(quoteLineItems.id, id));
  }

  async getUserQuotes(organizationId: string, userId: string, filters?: {
    searchCustomer?: string;
    searchProduct?: string;
    startDate?: string;
    endDate?: string;
    minPrice?: string;
    maxPrice?: string;
    userRole?: string;
    source?: string;
  }): Promise<QuoteWithRelations[]> {
    const conditions = [eq(quotes.organizationId, organizationId)];
    
    // Role-based filtering:
    // - owner/admin: can see all quotes (no userId filter)
    // - manager/employee: see only internal quotes they created
    // - customer: see only their own customer_quick_quote quotes
    const isStaff = filters?.userRole && ['owner', 'admin', 'manager', 'employee'].includes(filters.userRole);
    const isAdminOrOwner = filters?.userRole && ['owner', 'admin'].includes(filters.userRole);
    
    if (!isAdminOrOwner) {
      // Non-admin staff and customers are restricted to their own quotes
      conditions.push(eq(quotes.userId, userId));
    }
    
    // Source filtering based on role
    if (filters?.source) {
      // Explicit source filter from query params
      conditions.push(eq(quotes.source, filters.source));
    } else if (isStaff && !isAdminOrOwner) {
      // Regular staff (manager/employee) see only internal quotes
      conditions.push(eq(quotes.source, 'internal'));
    }
    // Admin/Owner with no explicit source filter see all
    // Customers with no explicit source filter see all their quotes (both types)

    if (filters?.searchCustomer) {
      conditions.push(like(quotes.customerName, `%${filters.searchCustomer}%`));
    }

    if (filters?.startDate) {
      conditions.push(gte(quotes.createdAt, new Date(filters.startDate)));
    }

    if (filters?.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(quotes.createdAt, endDate));
    }

    if (filters?.minPrice) {
      conditions.push(sql`${quotes.totalPrice}::numeric >= ${filters.minPrice}::numeric`);
    }

    if (filters?.maxPrice) {
      conditions.push(sql`${quotes.totalPrice}::numeric <= ${filters.maxPrice}::numeric`);
    }

    const userQuotes = await db
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(desc(quotes.createdAt));

    // Fetch user and line items for each quote
    return await Promise.all(
      userQuotes.map(async (quote) => {
        const [user] = await db.select().from(users).where(eq(users.id, quote.userId));
        
        // Fetch line items
        const lineItems = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quote.id));
        
        // Apply product filter if specified
        let filteredLineItems = lineItems;
        if (filters?.searchProduct) {
          filteredLineItems = lineItems.filter(item => item.productId === filters.searchProduct);
          // If no line items match the product filter, skip this quote
          if (filteredLineItems.length === 0) {
            return null;
          }
        }
        
        // Fetch product and variant details for line items
        const lineItemsWithRelations = await Promise.all(
          lineItems.map(async (lineItem) => {
            const [product] = await db.select().from(products).where(eq(products.id, lineItem.productId));
            let variant = null;
            if (lineItem.variantId) {
              [variant] = await db.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
            }
            return {
              ...lineItem,
              product,
              variant,
            };
          })
        );
        
        return {
          ...quote,
          user,
          lineItems: lineItemsWithRelations,
        };
      })
    ).then(results => results.filter(r => r !== null) as QuoteWithRelations[]);
  }

  async getAllQuotes(organizationId: string, filters?: {
    searchUser?: string;
    searchCustomer?: string;
    searchProduct?: string;
    startDate?: string;
    endDate?: string;
    minQuantity?: string;
    maxQuantity?: string;
  }): Promise<QuoteWithRelations[]> {
    const conditions = [eq(quotes.organizationId, organizationId)];

    if (filters?.searchCustomer) {
      conditions.push(like(quotes.customerName, `%${filters.searchCustomer}%`));
    }

    if (filters?.startDate) {
      conditions.push(gte(quotes.createdAt, new Date(filters.startDate)));
    }

    if (filters?.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(quotes.createdAt, endDate));
    }

    const whereClause = and(...conditions);

    const allQuotes = await db
      .select()
      .from(quotes)
      .where(whereClause)
      .orderBy(desc(quotes.createdAt));

    // Fetch user and line items for each quote
    return await Promise.all(
      allQuotes.map(async (quote) => {
        const [user] = await db.select().from(users).where(eq(users.id, quote.userId));
        
        // Apply user filter if specified
        if (filters?.searchUser && !user.email?.includes(filters.searchUser)) {
          return null;
        }
        
        // Fetch line items
        const lineItems = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quote.id));
        
        // Apply product filter if specified
        if (filters?.searchProduct) {
          const hasProduct = lineItems.some(item => item.productId === filters.searchProduct);
          if (!hasProduct) {
            return null;
          }
        }
        
        // Apply quantity filters if specified (check if any line item matches)
        if (filters?.minQuantity) {
          const hasMinQuantity = lineItems.some(item => item.quantity >= parseInt(filters.minQuantity!));
          if (!hasMinQuantity) return null;
        }
        
        if (filters?.maxQuantity) {
          const hasMaxQuantity = lineItems.some(item => item.quantity <= parseInt(filters.maxQuantity!));
          if (!hasMaxQuantity) return null;
        }
        
        // Fetch product and variant details for line items
        const lineItemsWithRelations = await Promise.all(
          lineItems.map(async (lineItem) => {
            const [product] = await db.select().from(products).where(eq(products.id, lineItem.productId));
            let variant = null;
            if (lineItem.variantId) {
              [variant] = await db.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
            }
            return {
              ...lineItem,
              product,
              variant,
            };
          })
        );
        
        return {
          ...quote,
          user,
          lineItems: lineItemsWithRelations,
        };
      })
    ).then(results => results.filter(r => r !== null) as QuoteWithRelations[]);
  }

  // Portal: Get quotes for a specific customer
  async getQuotesForCustomer(organizationId: string, customerId: string, filters?: {
    source?: string;
  }): Promise<QuoteWithRelations[]> {
    const conditions = [
      eq(quotes.organizationId, organizationId),
      eq(quotes.customerId, customerId),
    ];
    
    // Filter by source if specified (e.g., 'customer_quick_quote' for portal)
    if (filters?.source) {
      conditions.push(eq(quotes.source, filters.source));
    }

    const customerQuotes = await db
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(desc(quotes.createdAt));

    // Fetch user and line items for each quote
    return await Promise.all(
      customerQuotes.map(async (quote) => {
        const [user] = await db.select().from(users).where(eq(users.id, quote.userId));
        const lineItems = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quote.id));
        
        // Fetch product and variant details for line items
        const lineItemsWithRelations = await Promise.all(
          lineItems.map(async (lineItem) => {
            const [product] = await db.select().from(products).where(eq(products.id, lineItem.productId));
            let variant = null;
            if (lineItem.variantId) {
              [variant] = await db.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
            }
            return {
              ...lineItem,
              product,
              variant,
            };
          })
        );
        
        return {
          ...quote,
          user,
          lineItems: lineItemsWithRelations,
        };
      })
    );
  }

  // Pricing rules operations (tenant-scoped)
  async getAllPricingRules(organizationId: string): Promise<PricingRule[]> {
    return await db.select().from(pricingRules).where(eq(pricingRules.organizationId, organizationId));
  }

  async getPricingRuleByName(organizationId: string, name: string): Promise<PricingRule | undefined> {
    const [rule] = await db.select().from(pricingRules).where(and(eq(pricingRules.name, name), eq(pricingRules.organizationId, organizationId)));
    return rule;
  }

  async createPricingRule(organizationId: string, rule: InsertPricingRule): Promise<PricingRule> {
    const [newRule] = await db.insert(pricingRules).values({ ...rule, organizationId }).returning();
    return newRule;
  }

  async updatePricingRule(organizationId: string, ruleData: UpdatePricingRule): Promise<PricingRule> {
    const [updated] = await db
      .update(pricingRules)
      .set({ ...ruleData, updatedAt: new Date() })
      .where(and(eq(pricingRules.name, ruleData.name), eq(pricingRules.organizationId, organizationId)))
      .returning();
    return updated;
  }

  // Media assets operations (tenant-scoped)
  async getAllMediaAssets(organizationId: string): Promise<MediaAsset[]> {
    return await db.select().from(mediaAssets).where(eq(mediaAssets.organizationId, organizationId)).orderBy(desc(mediaAssets.uploadedAt));
  }

  async getMediaAssetById(organizationId: string, id: string): Promise<MediaAsset | undefined> {
    const [asset] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.organizationId, organizationId)));
    return asset;
  }

  async createMediaAsset(organizationId: string, assetData: Omit<InsertMediaAsset, 'organizationId'>): Promise<MediaAsset> {
    const [newAsset] = await db.insert(mediaAssets).values({ ...assetData, organizationId }).returning();
    return newAsset;
  }

  async deleteMediaAsset(organizationId: string, id: string): Promise<void> {
    await db.delete(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.organizationId, organizationId)));
  }

  // Formula templates operations (tenant-scoped)
  async getAllFormulaTemplates(organizationId: string): Promise<FormulaTemplate[]> {
    return await db
      .select()
      .from(formulaTemplates)
      .where(and(eq(formulaTemplates.organizationId, organizationId), eq(formulaTemplates.isActive, true)))
      .orderBy(formulaTemplates.category, formulaTemplates.name);
  }

  async getFormulaTemplateById(organizationId: string, id: string): Promise<FormulaTemplate | undefined> {
    const [template] = await db
      .select()
      .from(formulaTemplates)
      .where(and(eq(formulaTemplates.id, id), eq(formulaTemplates.organizationId, organizationId)));
    return template;
  }

  async createFormulaTemplate(organizationId: string, template: InsertFormulaTemplate): Promise<FormulaTemplate> {
    const [newTemplate] = await db
      .insert(formulaTemplates)
      .values({ ...template, organizationId })
      .returning();
    return newTemplate;
  }

  async updateFormulaTemplate(organizationId: string, id: string, updates: Partial<FormulaTemplate>): Promise<FormulaTemplate> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };

    const [template] = await db
      .update(formulaTemplates)
      .set(updateData)
      .where(and(eq(formulaTemplates.id, id), eq(formulaTemplates.organizationId, organizationId)))
      .returning();

    if (!template) {
      throw new Error("Formula template not found");
    }

    return template;
  }

  async deleteFormulaTemplate(organizationId: string, id: string): Promise<void> {
    await db.delete(formulaTemplates).where(and(eq(formulaTemplates.id, id), eq(formulaTemplates.organizationId, organizationId)));
  }

  async getProductsByFormulaTemplate(organizationId: string, templateId: string): Promise<Product[]> {
    // Get the formula template first
    const template = await this.getFormulaTemplateById(organizationId, templateId);
    if (!template) {
      return [];
    }

    // Find all products that use this exact formula within the organization
    const allProducts = await db.select().from(products).where(and(eq(products.isActive, true), eq(products.organizationId, organizationId)));
    return allProducts.filter(product => product.pricingFormula === template.formula);
  }

  // Email settings operations (tenant-scoped)
  async getAllEmailSettings(organizationId: string): Promise<EmailSettings[]> {
    return await db
      .select()
      .from(emailSettings)
      .where(and(eq(emailSettings.organizationId, organizationId), eq(emailSettings.isActive, true)))
      .orderBy(emailSettings.isDefault, emailSettings.createdAt);
  }

  async getEmailSettingsById(id: string, organizationId: string): Promise<EmailSettings | undefined> {
    const [settings] = await db
      .select()
      .from(emailSettings)
      .where(and(eq(emailSettings.id, id), eq(emailSettings.organizationId, organizationId)));
    return settings;
  }

  async getDefaultEmailSettings(organizationId: string): Promise<EmailSettings | undefined> {
    const [settings] = await db
      .select()
      .from(emailSettings)
      .where(and(eq(emailSettings.organizationId, organizationId), eq(emailSettings.isActive, true), eq(emailSettings.isDefault, true)))
      .limit(1);
    return settings;
  }

  async createEmailSettings(organizationId: string, settings: Omit<InsertEmailSettings, 'organizationId'>): Promise<EmailSettings> {
    // If this is set as default, unset all other defaults first within org
    if (settings.isDefault) {
      await db
        .update(emailSettings)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(emailSettings.isDefault, true), eq(emailSettings.organizationId, organizationId)));
    }

    const [newSettings] = await db
      .insert(emailSettings)
      .values({ ...settings, organizationId } as typeof emailSettings.$inferInsert)
      .returning();
    return newSettings;
  }

  async updateEmailSettings(organizationId: string, id: string, settingsData: Partial<Omit<InsertEmailSettings, 'organizationId'>>): Promise<EmailSettings> {
    // If this is being set as default, unset all other defaults first within org
    if (settingsData.isDefault) {
      await db
        .update(emailSettings)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(emailSettings.isDefault, true), eq(emailSettings.organizationId, organizationId), sql`${emailSettings.id} != ${id}`));
    }

    const updateData = {
      ...settingsData,
      updatedAt: new Date(),
    };

    const [updated] = await db
      .update(emailSettings)
      .set(updateData)
      .where(and(eq(emailSettings.id, id), eq(emailSettings.organizationId, organizationId)))
      .returning();
    return updated;
  }

  async deleteEmailSettings(organizationId: string, id: string): Promise<void> {
    await db.delete(emailSettings).where(and(eq(emailSettings.id, id), eq(emailSettings.organizationId, organizationId)));
  }

  // Company settings operations (tenant-scoped)
  async getCompanySettings(organizationId: string): Promise<CompanySettings | undefined> {
    const [settings] = await db.select().from(companySettings).where(eq(companySettings.organizationId, organizationId)).limit(1);
    return settings;
  }

  async createCompanySettings(organizationId: string, settingsData: Omit<InsertCompanySettings, 'organizationId'>): Promise<CompanySettings> {
    const [settings] = await db.insert(companySettings).values({ ...settingsData, organizationId }).returning();
    if (!settings) {
      throw new Error("Failed to create company settings");
    }
    return settings;
  }

  async updateCompanySettings(organizationId: string, id: string, settingsData: Partial<Omit<InsertCompanySettings, 'organizationId'>>): Promise<CompanySettings> {
    const updateData: any = {
      ...settingsData,
      updatedAt: new Date(),
    };

    const [settings] = await db
      .update(companySettings)
      .set(updateData)
      .where(and(eq(companySettings.id, id), eq(companySettings.organizationId, organizationId)))
      .returning();

    if (!settings) {
      throw new Error("Company settings not found");
    }

    return settings;
  }

  // Customer operations (tenant-scoped)
  async getAllCustomers(organizationId: string, filters?: {
    search?: string;
    status?: string;
    customerType?: string;
    assignedTo?: string;
  }): Promise<(Customer & { contacts?: CustomerContact[] })[]> {
    // If search is provided, we need to search across customers AND contacts
    if (filters?.search) {
      const searchPattern = `%${filters.search}%`;
      
      // Get all customers that match the search
      const customerConditions = [
        eq(customers.organizationId, organizationId),
        or(
          ilike(customers.companyName, searchPattern),
          ilike(customers.email, searchPattern)
        )
      ];

      if (filters.status) {
        customerConditions.push(eq(customers.status, filters.status));
      }
      if (filters.customerType) {
        customerConditions.push(eq(customers.customerType, filters.customerType as any));
      }
      if (filters.assignedTo) {
        customerConditions.push(eq(customers.assignedTo, filters.assignedTo));
      }

      const matchedCustomers = await db
        .select()
        .from(customers)
        .where(and(...customerConditions))
        .orderBy(customers.companyName);

      // Also search for customers by contact name/email
      const matchedContacts = await db
        .select()
        .from(customerContacts)
        .where(
          or(
            ilike(customerContacts.firstName, searchPattern),
            ilike(customerContacts.lastName, searchPattern),
            ilike(customerContacts.email, searchPattern)
          )
        );

      // Get unique customer IDs from contact matches
      const contactCustomerIds = Array.from(new Set(matchedContacts.map(c => c.customerId)));
      
      // Fetch customers from contact matches that aren't already in matchedCustomers
      const existingCustomerIds = new Set(matchedCustomers.map(c => c.id));
      const additionalCustomerIds = contactCustomerIds.filter(id => !existingCustomerIds.has(id));
      
      let additionalCustomers: Customer[] = [];
      if (additionalCustomerIds.length > 0) {
        const additionalConditions = [
          sql`${customers.id} IN (${sql.raw(additionalCustomerIds.map(id => `'${id}'`).join(','))})`
        ];
        
        if (filters.status) {
          additionalConditions.push(eq(customers.status, filters.status));
        }
        if (filters.customerType) {
          additionalConditions.push(eq(customers.customerType, filters.customerType as any));
        }
        if (filters.assignedTo) {
          additionalConditions.push(eq(customers.assignedTo, filters.assignedTo));
        }

        additionalCustomers = await db
          .select()
          .from(customers)
          .where(and(...additionalConditions))
          .orderBy(customers.companyName);
      }

      // Combine and deduplicate
      const allCustomers = [...matchedCustomers, ...additionalCustomers];
      
      // Fetch contacts for all matched customers
      const allCustomerIds = allCustomers.map(c => c.id);
      const allContacts = allCustomerIds.length > 0
        ? await db
            .select()
            .from(customerContacts)
            .where(sql`${customerContacts.customerId} IN (${sql.raw(allCustomerIds.map(id => `'${id}'`).join(','))})`)
        : [];

      // Attach contacts to customers
      return allCustomers.map(customer => ({
        ...customer,
        contacts: allContacts.filter(c => c.customerId === customer.id),
      }));
    }

    // No search - simple query
    const conditions = [eq(customers.organizationId, organizationId)];
    
    if (filters?.status) {
      conditions.push(eq(customers.status, filters.status));
    }
    if (filters?.customerType) {
      conditions.push(eq(customers.customerType, filters.customerType as any));
    }
    if (filters?.assignedTo) {
      conditions.push(eq(customers.assignedTo, filters.assignedTo));
    }

    let query = db.select().from(customers);
    query = query.where(and(...conditions)) as any;

    const allCustomers = await query.orderBy(customers.companyName);
    
    // Fetch contacts for all customers
    const allCustomerIds = allCustomers.map(c => c.id);
    const allContacts = allCustomerIds.length > 0
      ? await db
          .select()
          .from(customerContacts)
          .where(sql`${customerContacts.customerId} IN (${sql.raw(allCustomerIds.map(id => `'${id}'`).join(','))})`)
      : [];

    // Attach contacts to customers
    return allCustomers.map(customer => ({
      ...customer,
      contacts: allContacts.filter(c => c.customerId === customer.id),
    }));
  }

  async getCustomerById(id: string, organizationId: string): Promise<CustomerWithRelations | undefined> {
    const [customer] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)));

    if (!customer) {
      return undefined;
    }

    // Fetch related data with user relations
    const contacts = await db.select().from(customerContacts).where(eq(customerContacts.customerId, id)).catch(() => []);
    
    const notesWithUsers = await db
      .select()
      .from(customerNotes)
      .leftJoin(users, eq(customerNotes.userId, users.id))
      .where(eq(customerNotes.customerId, id))
      .orderBy(desc(customerNotes.createdAt))
      .catch(() => []);
    const notes = notesWithUsers.map(row => ({
      ...row.customer_notes,
      user: row.users || { id: '', email: null, firstName: null, lastName: null, profileImageUrl: null, isAdmin: false, role: 'employee', createdAt: new Date(), updatedAt: new Date() }
    })) as (CustomerNote & { user: User })[];
    
    const transactionsWithUsers = await db
      .select()
      .from(customerCreditTransactions)
      .leftJoin(users, eq(customerCreditTransactions.userId, users.id))
      .where(eq(customerCreditTransactions.customerId, id))
      .orderBy(desc(customerCreditTransactions.createdAt))
      .catch(() => []);
    const creditTransactions = transactionsWithUsers.map(row => ({
      ...row.customer_credit_transactions,
      user: row.users || { id: '', email: null, firstName: null, lastName: null, profileImageUrl: null, isAdmin: false, role: 'employee', createdAt: new Date(), updatedAt: new Date() }
    })) as (CustomerCreditTransaction & { user: User })[];
    
    const customerQuotes = await db.select().from(quotes).where(eq(quotes.customerId, id)).orderBy(desc(quotes.createdAt)).catch(() => []);

    return {
      ...customer,
      contacts,
      notes: notes as any, // Type cast needed due to notes field conflict (text field vs array relation)
      creditTransactions: creditTransactions as any,
      quotes: customerQuotes,
    };
  }

  async createCustomer(organizationId: string, customerData: Omit<InsertCustomer, 'organizationId'>): Promise<Customer> {
    const [customer] = await db.insert(customers).values({ ...customerData, organizationId }).returning();
    if (!customer) {
      throw new Error("Failed to create customer");
    }
    return customer;
  }

  async createCustomerWithPrimaryContact(
    organizationId: string,
    data: {
      customer: Omit<InsertCustomer, 'organizationId'>;
      primaryContact?: {
        firstName: string;
        lastName: string;
        email: string;
        phone?: string;
        title?: string;
        isPrimary?: boolean;
      } | null;
    }
  ): Promise<{ customer: Customer; contact?: CustomerContact | null }> {
    return await db.transaction(async (tx) => {
      const [customer] = await tx
        .insert(customers)
        .values({ ...data.customer, organizationId })
        .returning();

      if (!customer) {
        throw new Error("Failed to create customer");
      }

      let contact: CustomerContact | null = null;

      if (data.primaryContact) {
        const [createdContact] = await tx
          .insert(customerContacts)
          .values({
            customerId: customer.id,
            firstName: data.primaryContact.firstName,
            lastName: data.primaryContact.lastName,
            email: data.primaryContact.email,
            phone: data.primaryContact.phone,
            title: data.primaryContact.title,
            isPrimary: data.primaryContact.isPrimary ?? true,
          })
          .returning();

        if (!createdContact) {
          throw new Error("Failed to create primary contact");
        }

        contact = createdContact;
      }

      return { customer, contact };
    });
  }

  async updateCustomer(organizationId: string, id: string, customerData: Partial<Omit<InsertCustomer, 'organizationId'>>): Promise<Customer> {
    const updateData: any = {
      ...customerData,
      updatedAt: new Date(),
    };

    const [customer] = await db
      .update(customers)
      .set(updateData)
      .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)))
      .returning();

    if (!customer) {
      throw new Error("Customer not found");
    }

    return customer;
  }

  async deleteCustomer(organizationId: string, id: string): Promise<void> {
    await db.delete(customers).where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)));
  }

  // Customer contacts operations
  async getCustomerContacts(customerId: string): Promise<CustomerContact[]> {
    return await db
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId))
      .orderBy(desc(customerContacts.isPrimary), customerContacts.firstName);
  }

  async getCustomerContactById(id: string): Promise<CustomerContact | undefined> {
    const [contact] = await db.select().from(customerContacts).where(eq(customerContacts.id, id));
    return contact;
  }

  async createCustomerContact(contactData: InsertCustomerContact): Promise<CustomerContact> {
    const [contact] = await db.insert(customerContacts).values(contactData).returning();
    if (!contact) {
      throw new Error("Failed to create customer contact");
    }
    return contact;
  }

  async updateCustomerContact(id: string, contactData: Partial<InsertCustomerContact>): Promise<CustomerContact> {
    const updateData: any = {
      ...contactData,
      updatedAt: new Date(),
    };

    const [contact] = await db
      .update(customerContacts)
      .set(updateData)
      .where(eq(customerContacts.id, id))
      .returning();

    if (!contact) {
      throw new Error("Customer contact not found");
    }

    return contact;
  }

  async deleteCustomerContact(id: string): Promise<void> {
    await db.delete(customerContacts).where(eq(customerContacts.id, id));
  }

  // Customer notes operations
  async getCustomerNotes(customerId: string, filters?: {
    noteType?: string;
    assignedTo?: string;
  }): Promise<CustomerNote[]> {
    // Simplified query - removed non-existent fields (noteType, assignedTo, isPinned)
    return await db
      .select()
      .from(customerNotes)
      .where(eq(customerNotes.customerId, customerId))
      .orderBy(desc(customerNotes.createdAt));
  }

  async createCustomerNote(noteData: InsertCustomerNote): Promise<CustomerNote> {
    const [note] = await db.insert(customerNotes).values(noteData).returning();
    if (!note) {
      throw new Error("Failed to create customer note");
    }
    return note;
  }

  async updateCustomerNote(id: string, noteData: Partial<InsertCustomerNote>): Promise<CustomerNote> {
    const updateData: any = {
      ...noteData,
      updatedAt: new Date(),
    };

    const [note] = await db
      .update(customerNotes)
      .set(updateData)
      .where(eq(customerNotes.id, id))
      .returning();

    if (!note) {
      throw new Error("Customer note not found");
    }

    return note;
  }

  async deleteCustomerNote(id: string): Promise<void> {
    await db.delete(customerNotes).where(eq(customerNotes.id, id));
  }

  // Customer credit transactions operations
  async getCustomerCreditTransactions(customerId: string): Promise<CustomerCreditTransaction[]> {
    return await db
      .select()
      .from(customerCreditTransactions)
      .where(eq(customerCreditTransactions.customerId, customerId))
      .orderBy(desc(customerCreditTransactions.createdAt));
  }

  async createCustomerCreditTransaction(transactionData: InsertCustomerCreditTransaction): Promise<CustomerCreditTransaction> {
    const [transaction] = await db.insert(customerCreditTransactions).values(transactionData).returning();
    if (!transaction) {
      throw new Error("Failed to create customer credit transaction");
    }
    return transaction;
  }

  async updateCustomerCreditTransaction(id: string, transactionData: Partial<InsertCustomerCreditTransaction>): Promise<CustomerCreditTransaction> {
    const updateData: any = {
      ...transactionData,
      updatedAt: new Date(),
    };

    const [transaction] = await db
      .update(customerCreditTransactions)
      .set(updateData)
      .where(eq(customerCreditTransactions.id, id))
      .returning();

    if (!transaction) {
      throw new Error("Customer credit transaction not found");
    }

    return transaction;
  }

  async updateCustomerBalance(
    organizationId: string,
    customerId: string,
    amount: number,
    type: 'credit' | 'debit',
    reason: string,
    createdBy: string
  ): Promise<Customer> {
    // Get current customer
    const [customer] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)));
    if (!customer) {
      throw new Error("Customer not found");
    }

    const currentBalance = parseFloat(customer.currentBalance || '0');
    const creditLimit = parseFloat(customer.creditLimit || '0');

    // Calculate new balance
    const balanceAfter = type === 'credit'
      ? currentBalance + amount
      : currentBalance - amount;

    // Create transaction record
    await db.insert(customerCreditTransactions).values({
      customerId,
      userId: createdBy,
      transactionType: type,
      amount: amount.toString(),
      description: reason,
    });

    // Update customer balance
    const [updatedCustomer] = await db
      .update(customers)
      .set({
        currentBalance: balanceAfter.toString(),
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
      .returning();

    if (!updatedCustomer) {
      throw new Error("Failed to update customer balance");
    }

    return updatedCustomer;
  }

  // =============================
  // Order operations (core CRUD)
  // =============================

  private async generateNextOrderNumber(organizationId: string, tx?: any): Promise<string> {
    // Try globalVariables first (pattern similar to quotes). If missing, fallback to MAX(order_number)+1
    const executor = tx || db;
    try {
      const result = await executor.execute(sql`
        SELECT * FROM ${globalVariables}
        WHERE ${globalVariables.name} = 'next_order_number'
        AND ${globalVariables.organizationId} = ${organizationId}
        FOR UPDATE
      `);
      const row = (result as any).rows?.[0];
      if (row) {
        const current = Math.floor(Number(row.value));
        // Increment for next
        await executor.update(globalVariables)
          .set({ value: (current + 1).toString(), updatedAt: new Date() })
          .where(and(eq(globalVariables.id, row.id), eq(globalVariables.organizationId, organizationId)));
        return current.toString();
      }
    } catch (e) {
      // Ignore and fallback
    }
    // Fallback: compute max existing numeric orderNumber within this organization
    const maxResult = await db.execute(sql`SELECT MAX(CAST(order_number AS INTEGER)) AS max_num FROM orders WHERE order_number ~ '^[0-9]+$' AND organization_id = ${organizationId}`);
    const maxNum = (maxResult as any).rows?.[0]?.max_num ? Number((maxResult as any).rows[0].max_num) : 999;
    return (maxNum + 1).toString();
  }

  async getAllOrders(organizationId: string, filters?: {
    search?: string;
    status?: string;
    priority?: string;
    customerId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Order[]> {
    const conditions = [eq(orders.organizationId, organizationId)] as any[];
    if (filters?.search) {
      const pattern = `%${filters.search}%`;
      conditions.push(or(
        ilike(orders.orderNumber, pattern),
        ilike(orders.notesInternal, pattern)
      ));
    }
    if (filters?.status) conditions.push(eq(orders.status, filters.status));
    if (filters?.priority) conditions.push(eq(orders.priority, filters.priority));
    if (filters?.customerId) conditions.push(eq(orders.customerId, filters.customerId));
    if (filters?.startDate) conditions.push(gte(orders.createdAt, filters.startDate));
    if (filters?.endDate) conditions.push(lte(orders.createdAt, filters.endDate));

    let query = db.select().from(orders) as any;
    query = query.where(and(...conditions));
    query = query.orderBy(desc(orders.createdAt));
    const rows = await query;
    
    // Enrich orders with customer and contact data
    const enrichedOrders = await Promise.all(rows.map(async (order: Order) => {
      const [customer] = order.customerId 
        ? await db.select().from(customers).where(eq(customers.id, order.customerId))
        : [undefined];
      
      const [contact] = order.contactId 
        ? await db.select().from(customerContacts).where(eq(customerContacts.id, order.contactId))
        : [undefined];
      
      return { ...order, customer, contact };
    }));
    
    return enrichedOrders;
  }

  async getOrderById(organizationId: string, id: string): Promise<OrderWithRelations | undefined> {
    const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.organizationId, organizationId)));
    if (!order) return undefined;
    const rawLineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, id));
    const enrichedLineItems = await Promise.all(
      rawLineItems.map(async (li) => {
        const [product] = await db.select().from(products).where(eq(products.id, li.productId));
        let productVariant = null as any;
        if (li.productVariantId) {
          [productVariant] = await db.select().from(productVariants).where(eq(productVariants.id, li.productVariantId));
        }
        return { ...li, product, productVariant } as any;
      })
    );
    const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId)).catch(() => []);
    let contact: CustomerContact | null = null;
    if (order.contactId) {
      const contactRows = await db.select().from(customerContacts).where(eq(customerContacts.id, order.contactId));
      contact = contactRows[0] || null;
    }
    const [createdByUser] = await db.select().from(users).where(eq(users.id, order.createdByUserId));
    return {
      ...order,
      lineItems: enrichedLineItems,
      customer,
      contact,
      createdByUser,
    } as OrderWithRelations;
  }

  async createOrder(organizationId: string, data: {
    customerId: string;
    contactId?: string | null;
    quoteId?: string | null;
    status?: string;
    priority?: string;
    dueDate?: Date | null;
    promisedDate?: Date | null;
    discount?: number;
    notesInternal?: string | null;
    createdByUserId: string;
    lineItems: Omit<InsertOrderLineItem, 'orderId'>[];
  }): Promise<OrderWithRelations> {
    if (!data.customerId) throw new Error('customerId required');
    if (!data.lineItems || data.lineItems.length === 0) throw new Error('At least one line item required');
    const subtotal = data.lineItems.reduce((sum, li: any) => sum + Number(li.totalPrice || li.linePrice || 0), 0);
    const discount = data.discount || 0;
    const tax = 0; // Future: compute tax
    const total = subtotal - discount + tax;

    const created = await db.transaction(async (tx) => {
      const orderNumber = await this.generateNextOrderNumber(organizationId, tx);
      const orderInsert: typeof orders.$inferInsert = {
        organizationId,
        orderNumber,
        quoteId: data.quoteId || null,
        customerId: data.customerId,
        contactId: data.contactId || null,
        status: data.status || 'new',
        priority: data.priority || 'normal',
        dueDate: data.dueDate || null,
        promisedDate: data.promisedDate || null,
        subtotal: subtotal.toString(),
        tax: tax.toString(),
        total: total.toString(),
        discount: discount.toString(),
        notesInternal: data.notesInternal || null,
        createdByUserId: data.createdByUserId,
      };
      const [order] = await tx.insert(orders).values(orderInsert).returning();
      const lineItemsData = data.lineItems.map((li) => {
        const unit = li.unitPrice;
        return {
          orderId: order.id,
          quoteLineItemId: (li as any).quoteLineItemId || null,
          productId: li.productId,
            productVariantId: (li as any).productVariantId || (li as any).variantId || null,
          productType: (li as any).productType || 'wide_roll',
          description: (li as any).description || (li as any).productName || 'Item',
          width: li.width ? li.width.toString() : null,
          height: li.height ? li.height.toString() : null,
          quantity: li.quantity,
          sqft: (li as any).sqft ? (li as any).sqft.toString() : null,
          unitPrice: unit.toString(),
          totalPrice: li.totalPrice.toString(),
          status: 'queued',
          specsJson: (li as any).specsJson || null,
          selectedOptions: (li as any).selectedOptions || [],
          nestingConfigSnapshot: (li as any).nestingConfigSnapshot || null,
        } as typeof orderLineItems.$inferInsert;
      });
      const createdLineItems = lineItemsData.length ? await tx.insert(orderLineItems).values(lineItemsData).returning() : [];
      return { order, lineItems: createdLineItems };
    });

    // Auto-create jobs for each line item (if missing)
    await Promise.all(created.lineItems.map(async (li) => {
      const [existing] = await db.select().from(jobs).where(eq(jobs.orderLineItemId as any, li.id));
      if (!existing) {
        // Fetch product with productType relation
        const productWithType = await db.query.products.findFirst({
          where: eq(products.id, li.productId),
          with: { productType: true },
        });
        const productTypeName = (productWithType?.productType as any)?.name || 'Unknown';

        const jobInsert: typeof jobs.$inferInsert = {
          orderId: created.order.id,
          orderLineItemId: li.id,
          productType: productTypeName,
          status: 'pending_prepress',
          priority: 'normal',
          specsJson: (li as any).specsJson || null,
          assignedToUserId: null,
          notesInternal: null,
        } as any;
        const [newJob] = await db.insert(jobs).values(jobInsert).returning();
        await db.insert(jobStatusLog).values({
          jobId: newJob.id,
          oldStatusKey: null,
          newStatusKey: 'pending_prepress',
          userId: data.createdByUserId,
        } as InsertJobStatusLog).returning();
      }
    }));

    const [customer] = await db.select().from(customers).where(eq(customers.id, data.customerId));
    let contact: CustomerContact | null = null;
    if (data.contactId) {
      const contactRows = await db.select().from(customerContacts).where(eq(customerContacts.id, data.contactId));
      contact = contactRows[0] || null;
    }
    const [createdByUser] = await db.select().from(users).where(eq(users.id, data.createdByUserId));
    const enrichedLineItems = await Promise.all(
      created.lineItems.map(async (li) => {
        const [product] = await db.select().from(products).where(eq(products.id, li.productId));
        let productVariant = null as any;
        if (li.productVariantId) {
          [productVariant] = await db.select().from(productVariants).where(eq(productVariants.id, li.productVariantId));
        }
        return { ...li, product, productVariant } as any;
      })
    );
    return {
      ...created.order,
      lineItems: enrichedLineItems,
      customer,
      contact,
      createdByUser,
    } as OrderWithRelations;
  }

  async updateOrder(organizationId: string, id: string, order: Partial<InsertOrder>): Promise<Order> {
    const updateData: Record<string, any> = { ...order, updatedAt: new Date() };
    if (order.subtotal !== undefined) updateData.subtotal = order.subtotal.toString();
    if (order.tax !== undefined) updateData.tax = order.tax.toString();
    if (order.total !== undefined) updateData.total = order.total.toString();
    if (order.discount !== undefined) updateData.discount = order.discount.toString();
    const [updated] = await db.update(orders).set(updateData).where(and(eq(orders.id, id), eq(orders.organizationId, organizationId))).returning();
    if (!updated) throw new Error('Order not found');
    return updated;
  }

  async deleteOrder(organizationId: string, id: string): Promise<void> {
    await db.delete(orders).where(and(eq(orders.id, id), eq(orders.organizationId, organizationId)));
  }

  async getOrderLineItems(orderId: string): Promise<OrderLineItem[]> {
    return await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId)).orderBy(desc(orderLineItems.createdAt));
  }

  async getOrderLineItemById(id: string): Promise<OrderLineItem | undefined> {
    const [li] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, id));
    return li;
  }

  async createOrderLineItem(lineItem: InsertOrderLineItem): Promise<OrderLineItem> {
    const prepared: typeof orderLineItems.$inferInsert = {
      ...lineItem,
      width: lineItem.width ? lineItem.width.toString() : null,
      height: lineItem.height ? lineItem.height.toString() : null,
      sqft: lineItem.sqft ? lineItem.sqft.toString() : null,
      unitPrice: lineItem.unitPrice.toString(),
      totalPrice: lineItem.totalPrice.toString(),
    } as any;
    const [created] = await db.insert(orderLineItems).values(prepared).returning();
    
    // Check if product requires production job
    const [product] = await db.select().from(products).where(eq(products.id, created.productId));
    if (product && product.requiresProductionJob === false) {
      return created; // Skip job creation
    }

    // Auto-create job for this new line item if missing
    const [existing] = await db.select().from(jobs).where(eq(jobs.orderLineItemId as any, created.id));
    if (!existing) {
      // Fetch default status
      const [defaultStatus] = await db.select().from(jobStatuses).where(eq(jobStatuses.isDefault, true));
      const initialStatusKey = defaultStatus?.key || 'pending_prepress';

      // find orderId and fetch product with productType
      const [orderRow] = await db.select().from(orders).where(eq(orders.id, created.orderId));
      const productWithType = await db.query.products.findFirst({
        where: eq(products.id, created.productId),
        with: { productType: true },
      });
      const productTypeName = (productWithType?.productType as any)?.name || 'Unknown';

      const jobInsert: typeof jobs.$inferInsert = {
        orderId: orderRow?.id || created.orderId,
        orderLineItemId: created.id,
        productType: productTypeName,
        statusKey: initialStatusKey,
        priority: 'normal',
        specsJson: (created as any).specsJson || null,
        assignedToUserId: null,
        notesInternal: null,
      } as any;
      const [newJob] = await db.insert(jobs).values(jobInsert).returning();
      await db.insert(jobStatusLog).values({
        jobId: newJob.id,
        oldStatusKey: null,
        newStatusKey: initialStatusKey,
        userId: orderRow?.createdByUserId || null,
      } as InsertJobStatusLog).returning();
    }
    return created;
  }

  async updateOrderLineItem(id: string, lineItem: Partial<InsertOrderLineItem>): Promise<OrderLineItem> {
    const updateData: Record<string, any> = { ...lineItem, updatedAt: new Date() };
    ['width','height','sqft','unitPrice','totalPrice'].forEach(f => {
      const val = (lineItem as any)[f];
      if (val !== undefined) updateData[f] = val === null ? null : val.toString();
    });
    const [updated] = await db.update(orderLineItems).set(updateData).where(eq(orderLineItems.id, id)).returning();
    if (!updated) throw new Error('Order line item not found');
    
    // Check if product requires production job
    const [product] = await db.select().from(products).where(eq(products.id, updated.productId));
    if (product && product.requiresProductionJob === false) {
      return updated; // Skip job creation
    }

    // Do not delete jobs automatically; ensure a job exists (if productType changes or newly created somehow)
    const [existingJob] = await db.select().from(jobs).where(eq(jobs.orderLineItemId as any, id));
    if (!existingJob) {
      // Fetch default status and product with productType
      const [defaultStatus] = await db.select().from(jobStatuses).where(eq(jobStatuses.isDefault, true));
      const initialStatusKey = defaultStatus?.key || 'pending_prepress';

      const productWithType = await db.query.products.findFirst({
        where: eq(products.id, updated.productId),
        with: { productType: true },
      });
      const productTypeName = (productWithType?.productType as any)?.name || 'Unknown';

      const jobInsert: typeof jobs.$inferInsert = {
        orderId: updated.orderId,
        orderLineItemId: id,
        productType: productTypeName,
        statusKey: initialStatusKey,
        priority: 'normal',
        specsJson: (updated as any).specsJson || null,
        assignedToUserId: null,
        notesInternal: null,
      } as any;
      const [newJob] = await db.insert(jobs).values(jobInsert).returning();
      await db.insert(jobStatusLog).values({
        jobId: newJob.id,
        oldStatusKey: null,
        newStatusKey: initialStatusKey,
        userId: null,
      } as InsertJobStatusLog).returning();
    }
    return updated;
  }

  async deleteOrderLineItem(id: string): Promise<void> {
    await db.delete(orderLineItems).where(eq(orderLineItems.id, id));
  }

  // Shipment operations
  async getShipmentsByOrder(orderId: string): Promise<Shipment[]> {
    return await db.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(desc(shipments.shippedAt));
  }

  async getShipmentById(id: string): Promise<Shipment | undefined> {
    const [shipment] = await db.select().from(shipments).where(eq(shipments.id, id));
    return shipment;
  }

  async createShipment(shipment: InsertShipment): Promise<Shipment> {
    const [created] = await db.insert(shipments).values(shipment as any).returning();
    
    // Auto-update order fulfillment status to "shipped" if this is first shipment
    const existingShipments = await this.getShipmentsByOrder(created.orderId);
    if (existingShipments.length === 1) {
      await db.update(orders).set({ 
        fulfillmentStatus: 'shipped', 
        updatedAt: new Date() 
      }).where(eq(orders.id, created.orderId));
    }
    
    return created;
  }

  async updateShipment(id: string, shipment: Partial<InsertShipment>): Promise<Shipment> {
    const [updated] = await db.update(shipments).set({ ...shipment, updatedAt: new Date() } as any).where(eq(shipments.id, id)).returning();
    if (!updated) throw new Error('Shipment not found');
    
    // If delivered date is set, update order fulfillment status
    if (shipment.deliveredAt) {
      await db.update(orders).set({ 
        fulfillmentStatus: 'delivered', 
        updatedAt: new Date() 
      }).where(eq(orders.id, updated.orderId));
    }
    
    return updated;
  }

  async deleteShipment(id: string): Promise<void> {
    await db.delete(shipments).where(eq(shipments.id, id));
  }

  async convertQuoteToOrder(organizationId: string, quoteId: string, createdByUserId: string, options?: {
    customerId?: string;
    contactId?: string;
    dueDate?: Date;
    promisedDate?: Date;
    priority?: string;
    notesInternal?: Date; // Note: original interface had Date, likely should be string
    }): Promise<OrderWithRelations> {
    const quote = await this.getQuoteById(organizationId, quoteId);
    if (!quote) throw new Error('Quote not found');
    const customerId = options?.customerId || quote.customerId;
    if (!customerId) throw new Error('Quote missing customer');
    const contactId = options?.contactId || quote.contactId || null;
    const subtotal = quote.lineItems.reduce((sum, li: any) => sum + Number(li.linePrice), 0);
    const discount = 0; const tax = 0; const total = subtotal - discount + tax;
    const created = await db.transaction(async (tx) => {
      const orderNumber = await this.generateNextOrderNumber(organizationId, tx);
      const orderInsert: typeof orders.$inferInsert = {
        organizationId,
        orderNumber,
        quoteId: quote.id,
        customerId,
        contactId: contactId || null,
        status: 'new',
        priority: options?.priority || 'normal',
        dueDate: options?.dueDate || null,
        promisedDate: options?.promisedDate || null,
        subtotal: subtotal.toString(),
        tax: tax.toString(),
        total: total.toString(),
        discount: discount.toString(),
        notesInternal: (options as any)?.notesInternal || null,
        createdByUserId,
      };
      const [order] = await tx.insert(orders).values(orderInsert).returning();
      const lineItemsData = quote.lineItems.map((li: any) => {
        const unit = Number(li.linePrice) / (li.quantity || 1);
        return {
          orderId: order.id,
          quoteLineItemId: li.id,
          productId: li.productId,
          productVariantId: li.variantId || null,
          productType: li.productType || 'wide_roll',
          description: li.product?.name || li.productName || 'Item',
          width: li.width ? li.width.toString() : null,
          height: li.height ? li.height.toString() : null,
          quantity: li.quantity,
          sqft: (li as any).sqft ? (li as any).sqft.toString() : null,
          unitPrice: unit.toString(),
          totalPrice: li.linePrice.toString(),
          status: 'queued',
          specsJson: li.specsJson || null,
          selectedOptions: li.selectedOptions || [],
          nestingConfigSnapshot: null,
        } as typeof orderLineItems.$inferInsert;
      });
      const createdLineItems = await tx.insert(orderLineItems).values(lineItemsData).returning();
      return { order, lineItems: createdLineItems };
    });
    // Auto-create jobs for each created line item
    // Fetch default status
    const [defaultStatus] = await db.select().from(jobStatuses).where(and(eq(jobStatuses.isDefault, true), eq(jobStatuses.organizationId, organizationId)));
    const initialStatusKey = defaultStatus?.key || 'pending_prepress';

    await Promise.all(created.lineItems.map(async (li) => {
      // Check if product requires production job and fetch with productType
      const productWithType = await db.query.products.findFirst({
        where: eq(products.id, li.productId),
        with: { productType: true },
      });

      if (productWithType && productWithType.requiresProductionJob === false) {
        return; // Skip job creation
      }

      const [existing] = await db.select().from(jobs).where(eq(jobs.orderLineItemId as any, li.id));
      if (!existing) {
        const productTypeName = (productWithType?.productType as any)?.name || 'Unknown';

        const jobInsert: typeof jobs.$inferInsert = {
          orderId: created.order.id,
          orderLineItemId: li.id,
          productType: productTypeName,
          statusKey: initialStatusKey,
          priority: 'normal',
          specsJson: (li as any).specsJson || null,
          assignedToUserId: null,
          notesInternal: null,
        } as any;
        const [newJob] = await db.insert(jobs).values(jobInsert).returning();
        await db.insert(jobStatusLog).values({
          jobId: newJob.id,
          oldStatusKey: null,
          newStatusKey: initialStatusKey,
          userId: createdByUserId,
        } as InsertJobStatusLog).returning();
      }
    }));

    const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
    let contact: CustomerContact | null = null;
    if (contactId) {
      const contactRows = await db.select().from(customerContacts).where(eq(customerContacts.id, contactId));
      contact = contactRows[0] || null;
    }
    const [createdByUser] = await db.select().from(users).where(eq(users.id, createdByUserId));
    const enrichedLineItems = await Promise.all(
      created.lineItems.map(async (li) => {
        const [product] = await db.select().from(products).where(eq(products.id, li.productId));
        let productVariant = null as any;
        if (li.productVariantId) {
          [productVariant] = await db.select().from(productVariants).where(eq(productVariants.id, li.productVariantId));
        }
        return { ...li, product, productVariant } as any;
      })
    );
    return {
      ...created.order,
      lineItems: enrichedLineItems,
      customer,
      contact,
      createdByUser,
    } as OrderWithRelations;
  }

  // Audit log operations
  async createAuditLog(organizationId: string, log: Omit<InsertAuditLog, 'organizationId'>): Promise<AuditLog> {
    const [auditLog] = await db.insert(auditLogs).values({ ...log, organizationId }).returning();
    return auditLog;
  }

  async getAuditLogs(organizationId: string, filters?: {
    userId?: string;
    actionType?: string;
    entityType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<AuditLog[]> {
    const conditions = [eq(auditLogs.organizationId, organizationId)];

    if (filters?.userId) {
      conditions.push(eq(auditLogs.userId, filters.userId));
    }
    if (filters?.actionType) {
      conditions.push(eq(auditLogs.actionType, filters.actionType));
    }
    if (filters?.entityType) {
      conditions.push(eq(auditLogs.entityType, filters.entityType));
    }
    if (filters?.startDate) {
      conditions.push(gte(auditLogs.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(auditLogs.createdAt, filters.endDate));
    }

    let query = db.select().from(auditLogs);
    query = query.where(and(...conditions)) as any;
    query = query.orderBy(desc(auditLogs.createdAt)) as any;

    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }

    return await query;
  }

  // Order audit log operations
  async getOrderAuditLog(orderId: string): Promise<OrderAuditLog[]> {
    return await db
      .select()
      .from(orderAuditLog)
      .where(eq(orderAuditLog.orderId, orderId))
      .orderBy(desc(orderAuditLog.createdAt));
  }

  async createOrderAuditLog(log: InsertOrderAuditLog): Promise<OrderAuditLog> {
    const [auditLogEntry] = await db.insert(orderAuditLog).values(log).returning();
    return auditLogEntry;
  }

  // Order attachments operations
  async getOrderAttachments(orderId: string): Promise<OrderAttachment[]> {
    return await db
      .select()
      .from(orderAttachments)
      .where(eq(orderAttachments.orderId, orderId))
      .orderBy(desc(orderAttachments.createdAt));
  }

  async createOrderAttachment(attachment: InsertOrderAttachment): Promise<OrderAttachment> {
    const [newAttachment] = await db.insert(orderAttachments).values(attachment).returning();
    return newAttachment;
  }

  async updateOrderAttachment(id: string, updates: UpdateOrderAttachment): Promise<OrderAttachment> {
    const [updated] = await db
      .update(orderAttachments)
      .set(updates)
      .where(eq(orderAttachments.id, id))
      .returning();
    
    if (!updated) {
      throw new Error(`Order attachment ${id} not found`);
    }
    
    return updated;
  }

  async deleteOrderAttachment(id: string): Promise<void> {
    await db.delete(orderAttachments).where(eq(orderAttachments.id, id));
  }

  // ============================================================
  // ARTWORK & FILE HANDLING OPERATIONS
  // ============================================================

  async listOrderFiles(orderId: string): Promise<(OrderAttachment & { uploadedByUser?: User | null })[]> {
    const files = await db
      .select({
        file: orderAttachments,
        user: users,
      })
      .from(orderAttachments)
      .leftJoin(users, eq(orderAttachments.uploadedByUserId, users.id))
      .where(eq(orderAttachments.orderId, orderId))
      .orderBy(desc(orderAttachments.createdAt));

    return files.map(f => ({
      ...f.file,
      uploadedByUser: f.user || null,
    }));
  }

  async attachFileToOrder(data: InsertOrderAttachment): Promise<OrderAttachment> {
    // Validate isPrimary constraint: only one primary per role+side combination
    if (data.isPrimary && data.role && data.side) {
      // Unset any existing primary for this role+side
      await db
        .update(orderAttachments)
        .set({ isPrimary: false })
        .where(
          and(
            eq(orderAttachments.orderId, data.orderId),
            eq(orderAttachments.role, data.role as any),
            eq(orderAttachments.side, data.side as any)
          )
        );
    }

    const [newAttachment] = await db.insert(orderAttachments).values(data).returning();
    return newAttachment;
  }

  async updateOrderFileMeta(id: string, updates: UpdateOrderAttachment): Promise<OrderAttachment> {
    // If setting isPrimary=true, need to unset others for same role+side
    if (updates.isPrimary) {
      // Get the current file to know its orderId, role, side
      const [currentFile] = await db
        .select()
        .from(orderAttachments)
        .where(eq(orderAttachments.id, id));

      if (currentFile) {
        const role = updates.role || currentFile.role;
        const side = updates.side || currentFile.side;

        // Unset other primaries for this role+side
        await db
          .update(orderAttachments)
          .set({ isPrimary: false })
          .where(
            and(
              eq(orderAttachments.orderId, currentFile.orderId),
              eq(orderAttachments.role, role as any),
              eq(orderAttachments.side, side as any),
              sql`${orderAttachments.id} != ${id}` // Exclude current file
            )
          );
      }
    }

    const [updated] = await db
      .update(orderAttachments)
      .set(updates)
      .where(eq(orderAttachments.id, id))
      .returning();
    
    if (!updated) {
      throw new Error(`Order file ${id} not found`);
    }
    
    return updated;
  }

  async detachOrderFile(id: string): Promise<void> {
    await db.delete(orderAttachments).where(eq(orderAttachments.id, id));
  }

  async getOrderArtworkSummary(orderId: string): Promise<{
    front?: OrderAttachment | null;
    back?: OrderAttachment | null;
    other: OrderAttachment[];
  }> {
    const files = await db
      .select()
      .from(orderAttachments)
      .where(
        and(
          eq(orderAttachments.orderId, orderId),
          eq(orderAttachments.role, 'artwork')
        )
      )
      .orderBy(desc(orderAttachments.isPrimary), desc(orderAttachments.createdAt));

    const front = files.find(f => f.side === 'front' && f.isPrimary) || files.find(f => f.side === 'front') || null;
    const back = files.find(f => f.side === 'back' && f.isPrimary) || files.find(f => f.side === 'back') || null;
    const other = files.filter(f => f.side === 'na' || (!f.isPrimary && (f.side === 'front' || f.side === 'back')));

    return { front, back, other };
  }

  // Job file operations
  async listJobFiles(jobId: string): Promise<(JobFile & { file?: OrderAttachment | null })[]> {
    const jobFileRecords = await db
      .select({
        jobFile: jobFiles,
        file: orderAttachments,
      })
      .from(jobFiles)
      .leftJoin(orderAttachments, eq(jobFiles.fileId, orderAttachments.id))
      .where(eq(jobFiles.jobId, jobId))
      .orderBy(desc(jobFiles.createdAt));

    return jobFileRecords.map(record => ({
      ...record.jobFile,
      file: record.file || null,
    }));
  }

  async attachFileToJob(data: InsertJobFile): Promise<JobFile> {
    const [newJobFile] = await db.insert(jobFiles).values(data).returning();
    return newJobFile;
  }

  async detachJobFile(id: string): Promise<void> {
    await db.delete(jobFiles).where(eq(jobFiles.id, id));
  }

  async deleteOrderAttachment_DEPRECATED(id: string): Promise<void> {
    // DEPRECATED: Use detachOrderFile instead
    await db.delete(orderAttachments).where(eq(orderAttachments.id, id));
  }

  // Quote workflow operations
  async getQuoteWorkflowState(quoteId: string): Promise<QuoteWorkflowState | undefined> {
    const [state] = await db
      .select()
      .from(quoteWorkflowStates)
      .where(eq(quoteWorkflowStates.quoteId, quoteId));
    return state;
  }

  async createQuoteWorkflowState(state: InsertQuoteWorkflowState): Promise<QuoteWorkflowState> {
    const [newState] = await db.insert(quoteWorkflowStates).values(state).returning();
    return newState;
  }

  async updateQuoteWorkflowState(quoteId: string, updates: Partial<InsertQuoteWorkflowState>): Promise<QuoteWorkflowState> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };
    const [state] = await db
      .update(quoteWorkflowStates)
      .set(updateData)
      .where(eq(quoteWorkflowStates.quoteId, quoteId))
      .returning();
    if (!state) {
      throw new Error("Quote workflow state not found");
    }
    return state;
  }

  // Contacts operations
  async getAllContacts(organizationId: string, params: { search?: string; page?: number; pageSize?: number }): Promise<Array<CustomerContact & { companyName: string; ordersCount: number; quotesCount: number; lastActivityAt: Date | null }>> {
    const { search, page = 1, pageSize = 50 } = params;
    
    // Get all customers for this organization
    const orgCustomers = await db.select().from(customers).where(eq(customers.organizationId, organizationId));
    const customerIds = orgCustomers.map(c => c.id);
    const customerMap = new Map(orgCustomers.map(c => [c.id, c]));
    
    if (customerIds.length === 0) return [];
    
    let contactsQuery = db.select().from(customerContacts).where(inArray(customerContacts.customerId, customerIds)) as any;
    
    if (search) {
      const pattern = `%${search}%`;
      contactsQuery = contactsQuery.where(and(
        inArray(customerContacts.customerId, customerIds),
        or(
          ilike(customerContacts.firstName, pattern),
          ilike(customerContacts.lastName, pattern),
          ilike(customerContacts.email, pattern)
        )
      ));
    }
    
    contactsQuery = contactsQuery.orderBy(desc(customerContacts.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const contacts = await contactsQuery;
    
    // Enrich with company name and stats
    const enriched = await Promise.all(contacts.map(async (contact: CustomerContact) => {
      const customer = customerMap.get(contact.customerId);
      const companyName = customer?.companyName || 'Unknown';
      
      // Get orders count
      const contactOrders = await db.select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(eq(orders.contactId, contact.id));
      const ordersCount = Number(contactOrders[0]?.count || 0);
      
      // Get quotes count
      const contactQuotes = await db.select({ count: sql<number>`count(*)` })
        .from(quotes)
        .where(eq(quotes.contactId, contact.id));
      const quotesCount = Number(contactQuotes[0]?.count || 0);
      
      // Get last activity (most recent order or quote)
      const recentOrders = await db.select({ createdAt: orders.createdAt })
        .from(orders)
        .where(eq(orders.contactId, contact.id))
        .orderBy(desc(orders.createdAt))
        .limit(1);
      
      const recentQuotes = await db.select({ createdAt: quotes.createdAt })
        .from(quotes)
        .where(eq(quotes.contactId, contact.id))
        .orderBy(desc(quotes.createdAt))
        .limit(1);
      
      let lastActivityAt: Date | null = null;
      if (recentOrders[0] && recentQuotes[0]) {
        lastActivityAt = recentOrders[0].createdAt > recentQuotes[0].createdAt 
          ? recentOrders[0].createdAt 
          : recentQuotes[0].createdAt;
      } else if (recentOrders[0]) {
        lastActivityAt = recentOrders[0].createdAt;
      } else if (recentQuotes[0]) {
        lastActivityAt = recentQuotes[0].createdAt;
      }
      
      return {
        ...contact,
        companyName,
        ordersCount,
        quotesCount,
        lastActivityAt,
      };
    }));
    
    return enriched;
  }

  async getContactWithRelations(id: string): Promise<(CustomerContact & { customer?: Customer }) | undefined> {
    const [contact] = await db.select().from(customerContacts).where(eq(customerContacts.id, id));
    if (!contact) return undefined;
    const [customer] = contact.customerId ? await db.select().from(customers).where(eq(customers.id, contact.customerId)) : [undefined];
    return { ...contact, customer };
  }

  // =============================
  // Job operations (scoped through orders which have organizationId)
  // =============================
  async getJobs(organizationId: string, filters?: { statusKey?: string; assignedToUserId?: string; orderId?: string }): Promise<(Job & { order?: Order | null; orderLineItem?: OrderLineItem | null; customerName?: string; orderNumber?: string | null; dueDate?: Date | null; quantity?: number; mediaType?: string })[]> {
    // First, get all orders for this organization
    const orgOrders = await db.select({ id: orders.id }).from(orders).where(eq(orders.organizationId, organizationId));
    const orderIds = orgOrders.map(o => o.id);
    
    if (orderIds.length === 0) return [];
    
    const conditions: any[] = [inArray(jobs.orderId as any, orderIds)];
    if (filters?.statusKey) conditions.push(eq(jobs.statusKey as any, filters.statusKey));
    if (filters?.assignedToUserId) conditions.push(eq(jobs.assignedToUserId as any, filters.assignedToUserId));
    if (filters?.orderId) conditions.push(eq(jobs.orderId as any, filters.orderId));
    let query = db.select().from(jobs) as any;
    query = query.where(and(...conditions));
    query = query.orderBy(desc(jobs.createdAt as any));
    const records: Job[] = await query;
    const enriched = await Promise.all(records.map(async (j) => {
      const orderRecord = j.orderId ? await db.query.orders.findFirst({
        where: eq(orders.id, j.orderId),
        with: { customer: true },
      }) : undefined;
      const lineItemRecord = j.orderLineItemId ? await db.query.orderLineItems.findFirst({
        where: eq(orderLineItems.id, j.orderLineItemId),
        with: {
          product: true,
          productVariant: true,
        },
      }) : undefined;
      return {
        ...j,
        order: orderRecord || null,
        orderLineItem: lineItemRecord || null,
        customerName: orderRecord?.customer?.companyName || 'Unknown',
        orderNumber: orderRecord?.orderNumber || null,
        dueDate: orderRecord?.dueDate || null,
        quantity: lineItemRecord?.quantity || 0,
        mediaType: lineItemRecord?.productVariant?.name || lineItemRecord?.product?.name || 'Unknown',
      } as any;
    }));
    return enriched as any;
  }

  async getJob(organizationId: string, id: string): Promise<(Job & { order?: Order | null; orderLineItem?: OrderLineItem | null; notesLog?: JobNote[]; statusLog?: JobStatusLog[] }) | undefined> {
    // Find job and verify it belongs to an order in this organization
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!job || !job.orderId) return undefined;
    
    // Verify the order belongs to this organization
    const [order] = await db.select().from(orders).where(and(eq(orders.id, job.orderId), eq(orders.organizationId, organizationId)));
    if (!order) return undefined;
    
    const [li] = job.orderLineItemId ? await db.select().from(orderLineItems).where(eq(orderLineItems.id, job.orderLineItemId)) : [undefined];
    const notes = await db.select().from(jobNotes).where(eq(jobNotes.jobId as any, job.id)).orderBy(desc(jobNotes.createdAt as any));
    const status = await db.select().from(jobStatusLog).where(eq(jobStatusLog.jobId as any, job.id)).orderBy(desc(jobStatusLog.createdAt as any));
    return { ...job, order: order || null, orderLineItem: li || null, notesLog: notes as any, statusLog: status as any } as any;
  }

  async updateJob(organizationId: string, id: string, data: Partial<InsertJob>, userId?: string): Promise<Job> {
    // Find job and verify it belongs to an order in this organization
    const [existing] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!existing || !existing.orderId) throw new Error('Job not found');
    
    // Verify the order belongs to this organization
    const [order] = await db.select().from(orders).where(and(eq(orders.id, existing.orderId), eq(orders.organizationId, organizationId)));
    if (!order) throw new Error('Job not found');
    
    const updateData: any = { ...data, updatedAt: new Date() };
    if ((data as any).assignedTo !== undefined) {
      updateData.assignedToUserId = (data as any).assignedTo;
      delete (updateData as any).assignedTo;
    }
    if ((data as any).notes !== undefined) {
      updateData.notesInternal = (data as any).notes;
      delete (updateData as any).notes;
    }
    const [updated] = await db.update(jobs).set(updateData).where(eq(jobs.id, id)).returning();
    if (!updated) throw new Error('Job not found after update');
    if (data.statusKey && data.statusKey !== existing.statusKey) {
      await db.insert(jobStatusLog).values({
        jobId: id,
        oldStatusKey: existing.statusKey,
        newStatusKey: data.statusKey,
        userId: userId || null,
      } as InsertJobStatusLog).returning();
    }
    return updated;
  }

  async addJobNote(jobId: string, noteText: string, userId: string): Promise<JobNote> {
    const [note] = await db.insert(jobNotes).values({ jobId, userId, noteText } as InsertJobNote).returning();
    return note;
  }

  // =============================
  // Job Status Configuration
  // =============================
  async getJobStatuses(organizationId: string): Promise<JobStatus[]> {
    return db.select().from(jobStatuses).where(eq(jobStatuses.organizationId, organizationId)).orderBy(jobStatuses.position);
  }

  async createJobStatus(organizationId: string, data: Omit<InsertJobStatus, 'organizationId'>): Promise<JobStatus> {
    const [status] = await db.insert(jobStatuses).values({ ...data, organizationId }).returning();
    return status;
  }

  async updateJobStatus(organizationId: string, id: string, data: Partial<Omit<InsertJobStatus, 'organizationId'>>): Promise<JobStatus> {
    const [updated] = await db.update(jobStatuses).set({ ...data, updatedAt: new Date() }).where(and(eq(jobStatuses.id, id), eq(jobStatuses.organizationId, organizationId))).returning();
    if (!updated) throw new Error('Job status not found');
    return updated;
  }

  async deleteJobStatus(organizationId: string, id: string): Promise<void> {
    await db.delete(jobStatuses).where(and(eq(jobStatuses.id, id), eq(jobStatuses.organizationId, organizationId)));
  }

  async getJobsForOrder(organizationId: string, orderId: string): Promise<Job[]> {
    // Verify the order belongs to this organization
    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));
    if (!order) return [];
    return await db.select().from(jobs).where(eq(jobs.orderId as any, orderId)).orderBy(desc(jobs.createdAt as any));
  }

  // =============================
  // Inventory Management
  // =============================
  async getAllMaterials(organizationId: string): Promise<Material[]> {
    return db.select().from(materials).where(eq(materials.organizationId, organizationId)).orderBy(materials.name);
  }

  async getMaterialById(organizationId: string, id: string): Promise<Material | undefined> {
    const [material] = await db.select().from(materials).where(and(eq(materials.id, id), eq(materials.organizationId, organizationId)));
    return material;
  }

  async getMaterialBySku(organizationId: string, sku: string): Promise<Material | undefined> {
    const [material] = await db.select().from(materials).where(and(eq(materials.sku, sku), eq(materials.organizationId, organizationId)));
    return material;
  }

  async createMaterial(organizationId: string, material: Omit<InsertMaterial, 'organizationId'>): Promise<Material> {
    const [created] = await db.insert(materials).values({ ...material, organizationId } as any).returning();
    return created;
  }

  async updateMaterial(organizationId: string, id: string, materialData: Partial<InsertMaterial>): Promise<Material> {
    const [updated] = await db.update(materials)
      .set({ ...materialData, updatedAt: new Date() } as any)
      .where(and(eq(materials.id, id), eq(materials.organizationId, organizationId)))
      .returning();
    if (!updated) throw new Error('Material not found');
    return updated;
  }

  async deleteMaterial(organizationId: string, id: string): Promise<void> {
    await db.delete(materials).where(and(eq(materials.id, id), eq(materials.organizationId, organizationId)));
  }

  async getMaterialLowStockAlerts(organizationId: string): Promise<Material[]> {
    return db.select()
      .from(materials)
      .where(and(
        eq(materials.organizationId, organizationId),
        sql`${materials.stockQuantity} < ${materials.minStockAlert}`
      ))
      .orderBy(materials.name);
  }

  async adjustInventory(
    organizationId: string,
    materialId: string,
    type: "manual_increase" | "manual_decrease" | "waste" | "shrinkage" | "job_usage" | "purchase_receipt",
    quantityChange: number,
    userId: string,
    reason?: string,
    orderId?: string
  ): Promise<InventoryAdjustment> {
    return await db.transaction(async (tx) => {
      const [adjustment] = await tx.insert(inventoryAdjustments).values({
        materialId,
        type,
        quantityChange: `${quantityChange}`,
        reason: reason || null,
        orderId: orderId || null,
        userId,
      } as any).returning();

      await tx.update(materials)
        .set({
          stockQuantity: sql`${materials.stockQuantity} + ${quantityChange}`,
          updatedAt: new Date(),
        } as any)
        .where(and(eq(materials.id, materialId), eq(materials.organizationId, organizationId)));

      return adjustment;
    });
  }

  async getInventoryAdjustments(materialId: string): Promise<InventoryAdjustment[]> {
    return db.select()
      .from(inventoryAdjustments)
      .where(eq(inventoryAdjustments.materialId, materialId))
      .orderBy(desc(inventoryAdjustments.createdAt));
  }

  async recordMaterialUsage(usage: InsertOrderMaterialUsage): Promise<OrderMaterialUsage> {
    const [created] = await db.insert(orderMaterialUsage).values(usage as any).returning();
    return created;
  }

  async getMaterialUsageByOrder(orderId: string): Promise<OrderMaterialUsage[]> {
    return db.select()
      .from(orderMaterialUsage)
      .where(eq(orderMaterialUsage.orderId, orderId))
      .orderBy(orderMaterialUsage.createdAt);
  }

  async getMaterialUsageByLineItem(lineItemId: string): Promise<OrderMaterialUsage[]> {
    return db.select()
      .from(orderMaterialUsage)
      .where(eq(orderMaterialUsage.orderLineItemId, lineItemId))
      .orderBy(orderMaterialUsage.createdAt);
  }

  async getMaterialUsageByMaterial(materialId: string): Promise<OrderMaterialUsage[]> {
    return db.select()
      .from(orderMaterialUsage)
      .where(eq(orderMaterialUsage.materialId, materialId))
      .orderBy(orderMaterialUsage.createdAt);
  }

  async autoDeductInventoryWhenOrderMovesToProduction(organizationId: string, orderId: string, userId: string): Promise<void> {
    const lineItems = await db.select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, orderId));

    for (const lineItem of lineItems) {
      if (!lineItem.requiresInventory || !lineItem.materialId) continue;

      const existingUsage = await db.select()
        .from(orderMaterialUsage)
        .where(and(
          eq(orderMaterialUsage.orderId, orderId),
          eq(orderMaterialUsage.orderLineItemId, lineItem.id)
        ));
      if (existingUsage.length > 0) continue;

      const [material] = await db.select()
        .from(materials)
        .where(and(eq(materials.id, lineItem.materialId), eq(materials.organizationId, organizationId)));
      if (!material) continue;

      let quantityNeeded = 0;
      if (material.type === 'sheet') {
        quantityNeeded = lineItem.nestingConfigSnapshot?.totalSheets || lineItem.quantity;
      } else if (material.type === 'roll' && material.unitOfMeasure === 'sqft') {
        quantityNeeded = parseFloat(lineItem.sqft?.toString() || '0');
      } else {
        quantityNeeded = lineItem.quantity;
      }
      if (quantityNeeded <= 0) continue;

      await db.insert(orderMaterialUsage).values({
        orderId,
        orderLineItemId: lineItem.id,
        materialId: lineItem.materialId,
        quantityUsed: `${quantityNeeded}`,
        unitOfMeasure: material.unitOfMeasure,
        calculatedBy: 'auto',
      } as any);

      await this.adjustInventory(
        organizationId,
        lineItem.materialId,
        'job_usage',
        -quantityNeeded,
        userId,
        `Auto-deducted for order ${orderId}, line item: ${lineItem.description}`,
        orderId
      );
    }
  }


  // =============================
  // Vendor Operations
  // =============================
  async getVendors(organizationId: string, filters?: { search?: string; isActive?: boolean; page?: number; pageSize?: number }): Promise<Vendor[]> {
    const conditions: any[] = [eq(vendors.organizationId, organizationId)];
    if (filters?.search) {
      const s = `%${filters.search}%`;
      conditions.push(or(ilike(vendors.name, s), ilike(vendors.email, s), ilike(vendors.phone, s)));
    }
    if (typeof filters?.isActive === 'boolean') {
      conditions.push(eq(vendors.isActive, filters.isActive));
    }
    const page = filters?.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters?.pageSize && filters.pageSize > 0 ? filters.pageSize : 50;
    const offset = (page - 1) * pageSize;
    return await db.select().from(vendors).where(and(...conditions)).orderBy(vendors.name).limit(pageSize).offset(offset);
  }

  async getVendorById(organizationId: string, id: string): Promise<Vendor | undefined> {
    const [v] = await db.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId)));
    return v;
  }

  async createVendor(organizationId: string, data: Omit<InsertVendor, 'organizationId'>): Promise<Vendor> {
    const [created] = await db.insert(vendors).values({ ...data, organizationId } as any).returning();
    return created;
  }

  async updateVendor(organizationId: string, id: string, data: Partial<Omit<InsertVendor, 'organizationId'>>): Promise<Vendor> {
    const [updated] = await db.update(vendors).set({ ...data, updatedAt: new Date() } as any).where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId))).returning();
    if (!updated) throw new Error('Vendor not found');
    return updated;
  }

  async deleteVendor(organizationId: string, id: string): Promise<void> {
    // Soft delete if vendor has purchase orders; hard delete otherwise
    const existingPO = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.vendorId, id), eq(purchaseOrders.organizationId, organizationId))).limit(1);
    if (existingPO.length) {
      await db.update(vendors).set({ isActive: false, updatedAt: new Date() } as any).where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId)));
    } else {
      await db.delete(vendors).where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId)));
    }
  }

  // =============================
  // Purchase Order Operations
  // =============================
  private async generateNextPoNumber(organizationId: string, tx?: any): Promise<string> {
    const executor = tx || db;
    try {
      const result = await executor.execute(sql`SELECT * FROM ${globalVariables} WHERE ${globalVariables.name} = 'next_po_number' AND ${globalVariables.organizationId} = ${organizationId} FOR UPDATE`);
      const row = (result as any).rows?.[0];
      if (row) {
        const current = Math.floor(Number(row.value));
        await executor.update(globalVariables).set({ value: (current + 1).toString(), updatedAt: new Date() }).where(and(eq(globalVariables.id, row.id), eq(globalVariables.organizationId, organizationId)));
        return `PO-${current}`;
      }
    } catch {}
    const maxRes = await db.execute(sql`SELECT MAX(CAST(SUBSTRING(po_number FROM 4) AS INTEGER)) AS max_num FROM purchase_orders WHERE po_number ~ '^PO-[0-9]+$' AND organization_id = ${organizationId}`);
    const maxNum = (maxRes as any).rows?.[0]?.max_num ? Number((maxRes as any).rows[0].max_num) : 1000;
    return `PO-${maxNum + 1}`;
  }

  async getPurchaseOrders(organizationId: string, filters?: { vendorId?: string; status?: string; search?: string; startDate?: string; endDate?: string }): Promise<PurchaseOrder[]> {
    const conditions: any[] = [eq(purchaseOrders.organizationId, organizationId)];
    if (filters?.vendorId) conditions.push(eq(purchaseOrders.vendorId, filters.vendorId));
    if (filters?.status) conditions.push(eq(purchaseOrders.status, filters.status));
    if (filters?.search) {
      const s = `%${filters.search}%`;
      conditions.push(or(ilike(purchaseOrders.poNumber, s), ilike(purchaseOrders.notes, s)));
    }
    if (filters?.startDate) conditions.push(gte(purchaseOrders.issueDate, new Date(filters.startDate)));
    if (filters?.endDate) conditions.push(lte(purchaseOrders.issueDate, new Date(filters.endDate)));
    return await db.select().from(purchaseOrders).where(and(...conditions)).orderBy(desc(purchaseOrders.createdAt));
  }

  async getPurchaseOrderWithLines(organizationId: string, id: string): Promise<(PurchaseOrder & { vendor?: Vendor | null; lineItems: PurchaseOrderLineItem[] }) | undefined> {
    const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
    if (!po) return undefined;
    const vendorRecord = await this.getVendorById(organizationId, po.vendorId);
    const lines = await db.select().from(purchaseOrderLineItems).where(eq(purchaseOrderLineItems.purchaseOrderId, id)).orderBy(purchaseOrderLineItems.createdAt as any);
    return { ...po, vendor: vendorRecord || null, lineItems: lines } as any;
  }

  async createPurchaseOrder(organizationId: string, data: Omit<InsertPurchaseOrder, 'organizationId'> & { createdByUserId: string }): Promise<PurchaseOrder & { lineItems: PurchaseOrderLineItem[] }> {
    return await db.transaction(async (tx) => {
      const poNumber = await this.generateNextPoNumber(organizationId, tx);
      const lineValues = data.lineItems.map(li => {
        const lineTotal = Number(li.quantityOrdered) * Number(li.unitCost);
        return { ...li, lineTotal: lineTotal.toFixed(4) } as any;
      });
      const subtotal = lineValues.reduce((sum, li) => sum + Number(li.lineTotal), 0);
      const taxTotal = 0;
      const shippingTotal = 0;
      const grandTotal = subtotal + taxTotal + shippingTotal;
      const insertPO: any = {
        organizationId,
        poNumber,
        vendorId: data.vendorId,
        status: 'draft',
        issueDate: typeof data.issueDate === 'string' ? new Date(data.issueDate) : data.issueDate,
        expectedDate: data.expectedDate ? (typeof data.expectedDate === 'string' ? new Date(data.expectedDate) : data.expectedDate) : null,
        notes: (data as any).notes || null,
        subtotal: subtotal.toFixed(2),
        taxTotal: taxTotal.toFixed(2),
        shippingTotal: shippingTotal.toFixed(2),
        grandTotal: grandTotal.toFixed(2),
        createdByUserId: data.createdByUserId,
      };
      const [created] = await tx.insert(purchaseOrders).values(insertPO).returning();
      for (const lv of lineValues) {
        await tx.insert(purchaseOrderLineItems).values({ ...lv, purchaseOrderId: created.id } as any);
      }
      const lines = await tx.select().from(purchaseOrderLineItems).where(eq(purchaseOrderLineItems.purchaseOrderId, created.id));
      return { ...created, lineItems: lines } as any;
    });
  }

  async updatePurchaseOrder(organizationId: string, id: string, data: UpdatePurchaseOrder): Promise<PurchaseOrder & { lineItems: PurchaseOrderLineItem[] }> {
    return await db.transaction(async (tx) => {
      const existing = await this.getPurchaseOrderWithLines(organizationId, id);
      if (!existing) throw new Error('Purchase order not found');
      if (['received','cancelled'].includes(existing.status)) throw new Error('Cannot modify a finalized purchase order');
      const headerUpdates: any = {};
      if (data.expectedDate !== undefined) headerUpdates.expectedDate = data.expectedDate || null;
      if (data.notes !== undefined) headerUpdates.notes = (data as any).notes || null;
      if (data.status) headerUpdates.status = data.status;
      if (Object.keys(headerUpdates).length) headerUpdates.updatedAt = new Date();
      if (Object.keys(headerUpdates).length) await tx.update(purchaseOrders).set(headerUpdates).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
      if (Array.isArray((data as any).lineItems)) {
        await tx.delete(purchaseOrderLineItems).where(eq(purchaseOrderLineItems.purchaseOrderId, id));
        const newLines: any[] = (data as any).lineItems.map((li: any) => {
          const lineTotal = Number(li.quantityOrdered) * Number(li.unitCost);
          return { ...li, purchaseOrderId: id, lineTotal: lineTotal.toFixed(4) };
        });
        for (const nl of newLines) await tx.insert(purchaseOrderLineItems).values(nl);
        const subtotal = newLines.reduce((sum, li) => sum + Number(li.lineTotal), 0);
        const grandTotal = subtotal;
        await tx.update(purchaseOrders).set({ subtotal: subtotal.toFixed(2), grandTotal: grandTotal.toFixed(2), updatedAt: new Date() }).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
      }
      const updated = await this.getPurchaseOrderWithLines(organizationId, id);
      return updated as any;
    });
  }

  async deletePurchaseOrder(organizationId: string, id: string): Promise<void> {
    const existing = await this.getPurchaseOrderWithLines(organizationId, id);
    if (!existing) return;
    if (existing.status !== 'draft') throw new Error('Only draft purchase orders can be deleted');
    if (existing.lineItems.some((li: any) => Number(li.quantityReceived) > 0)) throw new Error('Cannot delete PO with received items');
    await db.delete(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
  }

  async sendPurchaseOrder(organizationId: string, id: string): Promise<PurchaseOrder> {
    const [updated] = await db.update(purchaseOrders).set({ status: 'sent', updatedAt: new Date() } as any).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId))).returning();
    if (!updated) throw new Error('Purchase order not found');
    return updated;
  }

  async receivePurchaseOrderLines(organizationId: string, purchaseOrderId: string, items: { lineItemId: string; quantityToReceive: number; receivedDate?: Date }[], userId: string): Promise<PurchaseOrder & { lineItems: PurchaseOrderLineItem[] }> {
    return await db.transaction(async (tx) => {
      const existing = await this.getPurchaseOrderWithLines(organizationId, purchaseOrderId);
      if (!existing) throw new Error('Purchase order not found');
      if (['cancelled','received'].includes(existing.status)) throw new Error('Cannot receive a finalized purchase order');
      const receivedDate = items.some(i => i.receivedDate) ? items[0].receivedDate : new Date();
      for (const item of items) {
        if (item.quantityToReceive <= 0) continue;
        const line = existing.lineItems.find(li => li.id === item.lineItemId);
        if (!line) throw new Error('Line item not found');
        const remaining = Number(line.quantityOrdered) - Number(line.quantityReceived);
        if (item.quantityToReceive > remaining) throw new Error('Cannot receive more than ordered');
        const newReceived = Number(line.quantityReceived) + item.quantityToReceive;
        await tx.update(purchaseOrderLineItems).set({ quantityReceived: newReceived.toFixed(2), updatedAt: new Date() } as any).where(eq(purchaseOrderLineItems.id, (line as any).id));
        if ((line as any).materialId) {
          await this.adjustInventory(organizationId, (line as any).materialId, 'purchase_receipt', item.quantityToReceive, userId, `PO receipt ${existing.poNumber}`);
          await tx.update(materials).set({ vendorCostPerUnit: (line as any).unitCost, updatedAt: new Date() } as any).where(and(eq(materials.id, (line as any).materialId), eq(materials.organizationId, organizationId)));
        }
      }
      const updated = await this.getPurchaseOrderWithLines(organizationId, purchaseOrderId);
      if (!updated) throw new Error('PO disappeared');
      const allReceived = updated.lineItems.every(li => Number(li.quantityReceived) >= Number(li.quantityOrdered));
      const anyReceived = updated.lineItems.some(li => Number(li.quantityReceived) > 0);
      let newStatus = updated.status;
      if (allReceived) newStatus = 'received'; else if (anyReceived && updated.status !== 'sent') newStatus = 'partially_received';
      const headerUpdate: any = { status: newStatus, updatedAt: new Date() };
      if (newStatus === 'received') headerUpdate.receivedDate = receivedDate;
      await tx.update(purchaseOrders).set(headerUpdate).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, organizationId)));
      const finalPO = await this.getPurchaseOrderWithLines(organizationId, purchaseOrderId);
      return finalPO as any;
    });
  }
}

export const storage = new DatabaseStorage();
