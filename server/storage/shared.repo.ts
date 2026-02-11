import { db } from "../db";
import { buildDuplicatedProductInsert } from "../lib/duplicateProductTransform";
import { readPbv2OverrideConfig, writePbv2OverrideConfig } from "../lib/pbv2OverrideConfig";
import {
    users,
    products,
    productTypes,
    productOptions,
    productVariants,
    pbv2TreeVersions,
    globalVariables,
    pricingFormulas,
    pricingRules,
    mediaAssets,
    formulaTemplates,
    emailSettings,
    companySettings,
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
    type PricingFormula,
    type InsertPricingFormula,
    type UpdatePricingFormula,
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
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";

function cloneJson<T>(value: T): T {
    const sc = (globalThis as any).structuredClone as ((v: any) => any) | undefined;
    if (typeof sc === 'function') return sc(value);
    return JSON.parse(JSON.stringify(value)) as T;
}

export class SharedRepository {
    constructor(private readonly dbInstance = db) { }

    // User operations (NOT tenant-scoped - users are global)
    async getUser(id: string): Promise<User | undefined> {
        const [user] = await this.dbInstance.select().from(users).where(eq(users.id, id));
        return user;
    }

    async getUserByEmail(email: string): Promise<User | undefined> {
        const [user] = await this.dbInstance.select().from(users).where(eq(users.email, email));
        return user;
    }

    async getAllUsers(): Promise<User[]> {
        return await this.dbInstance.select().from(users).orderBy(users.email);
    }

    async updateUser(id: string, updates: Partial<User>): Promise<User> {
        const updateData: any = {
            ...updates,
                updatedAt: new Date(),
        };

        const [user] = await this.dbInstance
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
        await this.dbInstance.delete(users).where(eq(users.id, id));
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

            const [user] = await this.dbInstance
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
                const [existingUser] = await this.dbInstance
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

                    const [updatedUser] = await this.dbInstance
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
        return await this.dbInstance.select().from(productTypes)
            .where(eq(productTypes.organizationId, organizationId))
            .orderBy(productTypes.sortOrder, productTypes.name);
    }

    async getProductTypeById(organizationId: string, id: string): Promise<SelectProductType | undefined> {
        const [type] = await this.dbInstance.select().from(productTypes)
            .where(and(eq(productTypes.id, id), eq(productTypes.organizationId, organizationId)));
        return type;
    }

    async createProductType(organizationId: string, data: Omit<InsertProductType, 'organizationId'>): Promise<SelectProductType> {
        const [newType] = await this.dbInstance
            .insert(productTypes)
            .values({
                ...data,
                organizationId,
            })
            .returning();
        return newType;
    }

    async updateProductType(organizationId: string, id: string, data: Partial<Omit<InsertProductType, 'organizationId'>>): Promise<SelectProductType> {
        const [updated] = await this.dbInstance
            .update(productTypes)
            .set(data)
            .where(and(eq(productTypes.id, id), eq(productTypes.organizationId, organizationId)))
            .returning();

        if (!updated) {
            throw new Error("Product type not found");
        }
        return updated;
    }

    async deleteProductType(organizationId: string, id: string): Promise<void> {
        await this.dbInstance.delete(productTypes).where(and(eq(productTypes.id, id), eq(productTypes.organizationId, organizationId)));
    }

    // Product operations (tenant-scoped)
    async getAllProducts(organizationId: string): Promise<Product[]> {
        return await this.dbInstance.select().from(products)
            .where(eq(products.organizationId, organizationId))
            .orderBy(products.name);
    }

    async getProductById(organizationId: string, id: string): Promise<Product | undefined> {
        const [product] = await this.dbInstance.select().from(products)
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
        const [newProduct] = await this.dbInstance.insert(products).values(cleanProduct).returning();
        return newProduct;
    }

    async updateProduct(organizationId: string, id: string, productData: Omit<UpdateProduct, 'organizationId'>): Promise<Product> {
        // Drizzle timestamp columns expect a JS Date (not an ISO string).
        const cleanProductData: any = { updatedAt: new Date() };
        Object.entries(productData).forEach(([k, v]) => {
            if (k === 'variantLabel' && v === null) {
                // Reset to default value when null
                cleanProductData[k] = 'Variant';
                return;
            }
            cleanProductData[k] = v;
        });
        const [updated] = await this.dbInstance
            .update(products)
            .set(cleanProductData)
            .where(and(eq(products.id, id), eq(products.organizationId, organizationId)))
            .returning();
        return updated;
    }

    async deleteProduct(organizationId: string, id: string): Promise<void> {
        await this.dbInstance.delete(products).where(and(eq(products.id, id), eq(products.organizationId, organizationId)));
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
            pricingMode: originalProduct.pricingMode,
            isService: originalProduct.isService,
            artworkPolicy: originalProduct.artworkPolicy,
            primaryMaterialId: originalProduct.primaryMaterialId,
            optionsJson: originalProduct.optionsJson,
            pricingProfileKey: originalProduct.pricingProfileKey ?? "default",
            pricingProfileConfig: originalProduct.pricingProfileConfig,
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

    async duplicateProduct(organizationId: string, id: string, userId: string | null): Promise<Product> {
        return await this.dbInstance.transaction(async (tx) => {
            const [originalProduct] = await tx
                .select()
                .from(products)
                .where(and(eq(products.id, id), eq(products.organizationId, organizationId)))
                .limit(1);

            if (!originalProduct) {
                throw new Error('Product not found');
            }

            const newProductData = buildDuplicatedProductInsert(originalProduct);

            const [newProduct] = await tx
                .insert(products)
                .values({
                    organizationId,
                    ...(newProductData as any),
                })
                .returning();

            // Clone legacy variants
            const originalVariants = await tx
                .select()
                .from(productVariants)
                .where(eq(productVariants.productId, id))
                .orderBy(productVariants.displayOrder);

            for (const variant of originalVariants) {
                await tx.insert(productVariants).values({
                    productId: newProduct.id,
                    name: variant.name,
                    description: variant.description,
                    basePricePerSqft: variant.basePricePerSqft,
                    wholesaleBaseRate: variant.wholesaleBaseRate,
                    wholesaleMinCharge: variant.wholesaleMinCharge,
                    retailBaseRate: variant.retailBaseRate,
                    retailMinCharge: variant.retailMinCharge,
                    volumePricing: cloneJson(variant.volumePricing as any),
                    isTaxable: variant.isTaxable,
                    taxCategoryId: variant.taxCategoryId,
                    isDefault: variant.isDefault,
                    displayOrder: variant.displayOrder,
                    isActive: variant.isActive,
                } as any);
            }

            // Clone legacy options (preserve parent/child relationships)
            const originalOptions = await tx
                .select()
                .from(productOptions)
                .where(eq(productOptions.productId, id))
                .orderBy(productOptions.displayOrder);

            const optionIdMap: Record<string, string> = {};

            const parentOptions = originalOptions.filter(opt => !opt.parentOptionId);
            for (const option of parentOptions) {
                const [newOption] = await tx
                    .insert(productOptions)
                    .values({
                        productId: newProduct.id,
                        name: option.name,
                        description: option.description,
                        type: option.type,
                        defaultValue: option.defaultValue,
                        defaultSelection: option.defaultSelection,
                        isDefaultEnabled: option.isDefaultEnabled,
                        setupCost: option.setupCost,
                        priceFormula: option.priceFormula,
                        parentOptionId: null,
                        displayOrder: option.displayOrder,
                        isActive: option.isActive,
                    } as any)
                    .returning();

                optionIdMap[option.id] = newOption.id;
            }

            const childOptions = originalOptions.filter(opt => !!opt.parentOptionId);
            for (const option of childOptions) {
                const newParentId = option.parentOptionId ? optionIdMap[option.parentOptionId] : null;
                const [newOption] = await tx
                    .insert(productOptions)
                    .values({
                        productId: newProduct.id,
                        name: option.name,
                        description: option.description,
                        type: option.type,
                        defaultValue: option.defaultValue,
                        defaultSelection: option.defaultSelection,
                        isDefaultEnabled: option.isDefaultEnabled,
                        setupCost: option.setupCost,
                        priceFormula: option.priceFormula,
                        parentOptionId: newParentId,
                        displayOrder: option.displayOrder,
                        isActive: option.isActive,
                    } as any)
                    .returning();

                optionIdMap[option.id] = newOption.id;
            }

            // Clone PBV2 tree versions (draft + active pointer)
            const [originalDraft] = await tx
                .select()
                .from(pbv2TreeVersions)
                .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.productId, id), eq(pbv2TreeVersions.status, 'DRAFT')))
                .orderBy(desc(pbv2TreeVersions.updatedAt))
                .limit(1);

            if (originalDraft) {
                await tx.insert(pbv2TreeVersions).values({
                    organizationId,
                    productId: newProduct.id,
                    status: 'DRAFT',
                    schemaVersion: originalDraft.schemaVersion,
                    treeJson: cloneJson(originalDraft.treeJson as any),
                    publishedAt: null,
                    createdByUserId: userId,
                    updatedByUserId: userId,
                } as any);
            }

            if (originalProduct.pbv2ActiveTreeVersionId) {
                const [originalActive] = await tx
                    .select()
                    .from(pbv2TreeVersions)
                    .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, originalProduct.pbv2ActiveTreeVersionId)))
                    .limit(1);

                if (originalActive) {
                    // Clone active tree as DRAFT (never directly create ACTIVE)
                    const [newDraftFromActive] = await tx
                        .insert(pbv2TreeVersions)
                        .values({
                            organizationId,
                            productId: newProduct.id,
                            status: 'DRAFT',
                            schemaVersion: originalActive.schemaVersion,
                            treeJson: cloneJson(originalActive.treeJson as any),
                            publishedAt: null,
                            createdByUserId: userId,
                            updatedByUserId: userId,
                        } as any)
                        .returning();

                    // Only activate if schemaVersion === 2 (guards prevent v1 activation)
                    if (originalActive.schemaVersion === 2) {
                        // Validate tree before activation
                        const { validateTreeHasBasePrice } = await import("../../shared/pbv2/validator/validateBasePrice");
                        const { validateTreeForPublish, DEFAULT_VALIDATE_OPTS } = await import("../../shared/pbv2/validator");
                        
                        const treeJson = cloneJson(originalActive.treeJson as any);
                        const basePriceValidation = validateTreeHasBasePrice(treeJson);
                        const publishValidation = validateTreeForPublish(treeJson, DEFAULT_VALIDATE_OPTS);

                        if (basePriceValidation.errors.length === 0 && publishValidation.errors.length === 0) {
                            // Activation logic: promote DRAFT to ACTIVE
                            const publishedAt = new Date();
                            const nextTreeJson = {
                                ...treeJson,
                                schemaVersion: 2,
                                status: "ACTIVE",
                            };

                            await tx
                                .update(pbv2TreeVersions)
                                .set({
                                    status: 'ACTIVE' as any,
                                    publishedAt,
                                    updatedAt: publishedAt,
                                    updatedByUserId: userId,
                                    treeJson: nextTreeJson as any,
                                } as any)
                                .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, newDraftFromActive.id)));

                            await tx
                                .update(products)
                                .set({
                                    pbv2ActiveTreeVersionId: newDraftFromActive.id,
                                    updatedAt: publishedAt,
                                } as any)
                                .where(and(eq(products.id, newProduct.id), eq(products.organizationId, organizationId)));
                        }
                        // If validation fails, tree stays as DRAFT
                    }
                    // If schemaVersion !== 2, tree stays as DRAFT (no activation)
                }
            }

            // Clone PBV2 override tree version (ARCHIVED) if configured
            const override = readPbv2OverrideConfig(originalProduct.pricingProfileConfig as any);
            if (override.enabled && override.treeVersionId) {
                const [originalOverride] = await tx
                    .select()
                    .from(pbv2TreeVersions)
                    .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, override.treeVersionId)))
                    .limit(1);

                if (originalOverride) {
                    const [newOverride] = await tx
                        .insert(pbv2TreeVersions)
                        .values({
                            organizationId,
                            productId: newProduct.id,
                            status: 'ARCHIVED',
                            schemaVersion: originalOverride.schemaVersion,
                            treeJson: cloneJson(originalOverride.treeJson as any),
                            publishedAt: originalOverride.publishedAt,
                            createdByUserId: userId,
                            updatedByUserId: userId,
                        } as any)
                        .returning();

                    const updatedPricingProfileConfig = writePbv2OverrideConfig(newProduct.pricingProfileConfig as any, {
                        enabled: true,
                        treeVersionId: newOverride.id,
                    });

                    await tx
                        .update(products)
                        .set({
                            pricingProfileConfig: updatedPricingProfileConfig as any,
                            updatedAt: new Date(),
                        } as any)
                        .where(and(eq(products.id, newProduct.id), eq(products.organizationId, organizationId)));
                } else {
                    const updatedPricingProfileConfig = writePbv2OverrideConfig(newProduct.pricingProfileConfig as any, {
                        enabled: false,
                        treeVersionId: null,
                    });

                    await tx
                        .update(products)
                        .set({
                            pricingProfileConfig: updatedPricingProfileConfig as any,
                            updatedAt: new Date(),
                        } as any)
                        .where(and(eq(products.id, newProduct.id), eq(products.organizationId, organizationId)));
                }
            }

            const [finalProduct] = await tx
                .select()
                .from(products)
                .where(and(eq(products.id, newProduct.id), eq(products.organizationId, organizationId)))
                .limit(1);

            return finalProduct ?? newProduct;
        });
    }

    // Product options operations
    async getProductOptions(productId: string): Promise<ProductOption[]> {
        return await this.dbInstance
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

        const [newOption] = await this.dbInstance.insert(productOptions).values(optionData).returning();
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

        const [updated] = await this.dbInstance
            .update(productOptions)
            .set(updateData)
            .where(eq(productOptions.id, id))
            .returning();
        return updated;
    }

    async deleteProductOption(id: string): Promise<void> {
        await this.dbInstance.delete(productOptions).where(eq(productOptions.id, id));
    }

    // Product variants operations
    async getProductVariants(productId: string): Promise<ProductVariant[]> {
        return await this.dbInstance
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

        const [newVariant] = await this.dbInstance.insert(productVariants).values(variantData).returning();
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

        const [updated] = await this.dbInstance
            .update(productVariants)
            .set(updateData)
            .where(eq(productVariants.id, id))
            .returning();
        return updated;
    }

    async deleteProductVariant(id: string): Promise<void> {
        await this.dbInstance.delete(productVariants).where(eq(productVariants.id, id));
    }

    // Global variables operations (tenant-scoped)
    async getAllGlobalVariables(organizationId: string): Promise<GlobalVariable[]> {
        return await this.dbInstance
            .select()
            .from(globalVariables)
            .where(and(eq(globalVariables.organizationId, organizationId), eq(globalVariables.isActive, true)))
            .orderBy(globalVariables.category, globalVariables.name);
    }

    async getGlobalVariableByName(organizationId: string, name: string): Promise<GlobalVariable | undefined> {
        const [variable] = await this.dbInstance
            .select()
            .from(globalVariables)
            .where(and(eq(globalVariables.name, name), eq(globalVariables.organizationId, organizationId)));
        return variable;
    }

    async getGlobalVariableById(organizationId: string, id: string): Promise<GlobalVariable | undefined> {
        const [variable] = await this.dbInstance
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

        const [newVariable] = await this.dbInstance.insert(globalVariables).values(variableData).returning();
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

        const [updated] = await this.dbInstance
            .update(globalVariables)
            .set(updateData)
            .where(and(eq(globalVariables.id, id), eq(globalVariables.organizationId, organizationId)))
            .returning();
        return updated;
    }

    async deleteGlobalVariable(organizationId: string, id: string): Promise<void> {
        await this.dbInstance.delete(globalVariables).where(and(eq(globalVariables.id, id), eq(globalVariables.organizationId, organizationId)));
    }

    // Pricing Formulas operations (tenant-scoped)
    async getPricingFormulas(organizationId: string): Promise<PricingFormula[]> {
        return await this.dbInstance.select().from(pricingFormulas)
            .where(and(
                eq(pricingFormulas.organizationId, organizationId),
                eq(pricingFormulas.isActive, true)
            ))
            .orderBy(pricingFormulas.name);
    }

    async getPricingFormulaById(organizationId: string, id: string): Promise<PricingFormula | undefined> {
        const [formula] = await this.dbInstance.select().from(pricingFormulas)
            .where(and(
                eq(pricingFormulas.id, id),
                eq(pricingFormulas.organizationId, organizationId)
            ));
        return formula;
    }

    async getPricingFormulaWithProducts(organizationId: string, id: string): Promise<{ formula: PricingFormula; products: Product[] } | null> {
        const formula = await this.getPricingFormulaById(organizationId, id);
        if (!formula) return null;

        const linkedProducts = await this.dbInstance.select().from(products)
            .where(and(
                eq(products.organizationId, organizationId),
                eq(products.pricingFormulaId, id)
            ))
            .orderBy(products.name);

        return { formula, products: linkedProducts };
    }

    async createPricingFormula(organizationId: string, input: InsertPricingFormula): Promise<PricingFormula> {
        const [formula] = await this.dbInstance.insert(pricingFormulas)
            .values({
                ...input,
                organizationId,
            })
            .returning();
        return formula;
    }

    async updatePricingFormula(organizationId: string, id: string, input: UpdatePricingFormula): Promise<PricingFormula> {
        const [updated] = await this.dbInstance.update(pricingFormulas)
            .set({
                ...input,
                updatedAt: new Date(),
            })
            .where(and(
                eq(pricingFormulas.id, id),
                eq(pricingFormulas.organizationId, organizationId)
            ))
            .returning();
        return updated;
    }

    async deletePricingFormula(organizationId: string, id: string): Promise<void> {
        // Soft delete - set isActive to false
        await this.dbInstance.update(pricingFormulas)
            .set({ isActive: false, updatedAt: new Date() })
            .where(and(
                eq(pricingFormulas.id, id),
                eq(pricingFormulas.organizationId, organizationId)
            ));
    }

    // Pricing rules operations (tenant-scoped)
    async getAllPricingRules(organizationId: string): Promise<PricingRule[]> {
        return await this.dbInstance.select().from(pricingRules).where(eq(pricingRules.organizationId, organizationId));
    }

    async getPricingRuleByName(organizationId: string, name: string): Promise<PricingRule | undefined> {
        const [rule] = await this.dbInstance.select().from(pricingRules).where(and(eq(pricingRules.name, name), eq(pricingRules.organizationId, organizationId)));
        return rule;
    }

    async createPricingRule(organizationId: string, rule: InsertPricingRule): Promise<PricingRule> {
        const [newRule] = await this.dbInstance.insert(pricingRules).values({ ...rule, organizationId }).returning();
        return newRule;
    }

    async updatePricingRule(organizationId: string, ruleData: UpdatePricingRule): Promise<PricingRule> {
        const [updated] = await this.dbInstance
            .update(pricingRules)
            .set({ ...ruleData, updatedAt: new Date() })
            .where(and(eq(pricingRules.name, ruleData.name), eq(pricingRules.organizationId, organizationId)))
            .returning();
        return updated;
    }

    // Media assets operations (tenant-scoped)
    async getAllMediaAssets(organizationId: string): Promise<MediaAsset[]> {
        return await this.dbInstance.select().from(mediaAssets).where(eq(mediaAssets.organizationId, organizationId)).orderBy(desc(mediaAssets.uploadedAt));
    }

    async getMediaAssetById(organizationId: string, id: string): Promise<MediaAsset | undefined> {
        const [asset] = await this.dbInstance.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.organizationId, organizationId)));
        return asset;
    }

    async createMediaAsset(organizationId: string, assetData: Omit<InsertMediaAsset, 'organizationId'>): Promise<MediaAsset> {
        const [newAsset] = await this.dbInstance.insert(mediaAssets).values({ ...assetData, organizationId }).returning();
        return newAsset;
    }

    async deleteMediaAsset(organizationId: string, id: string): Promise<void> {
        await this.dbInstance.delete(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.organizationId, organizationId)));
    }

    // Formula templates operations (tenant-scoped)
    async getAllFormulaTemplates(organizationId: string): Promise<FormulaTemplate[]> {
        return await this.dbInstance
            .select()
            .from(formulaTemplates)
            .where(and(eq(formulaTemplates.organizationId, organizationId), eq(formulaTemplates.isActive, true)))
            .orderBy(formulaTemplates.category, formulaTemplates.name);
    }

    async getFormulaTemplateById(organizationId: string, id: string): Promise<FormulaTemplate | undefined> {
        const [template] = await this.dbInstance
            .select()
            .from(formulaTemplates)
            .where(and(eq(formulaTemplates.id, id), eq(formulaTemplates.organizationId, organizationId)));
        return template;
    }

    async createFormulaTemplate(organizationId: string, template: Omit<InsertFormulaTemplate, 'organizationId'>): Promise<FormulaTemplate> {
        const [newTemplate] = await this.dbInstance
            .insert(formulaTemplates)
            .values({ ...template, organizationId })
            .returning();
        return newTemplate;
    }

    async updateFormulaTemplate(organizationId: string, id: string, updates: Partial<Omit<FormulaTemplate, 'organizationId'>>): Promise<FormulaTemplate> {
        const updateData: any = {
            ...updates,
                updatedAt: new Date(),
        };

        const [template] = await this.dbInstance
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
        await this.dbInstance.delete(formulaTemplates).where(and(eq(formulaTemplates.id, id), eq(formulaTemplates.organizationId, organizationId)));
    }

    async getProductsByFormulaTemplate(organizationId: string, templateId: string): Promise<Product[]> {
        // Get the formula template first
        const template = await this.getFormulaTemplateById(organizationId, templateId);
        if (!template) {
            return [];
        }

        // Find all products that use this exact formula within the organization
        const allProducts = await this.dbInstance.select().from(products).where(and(eq(products.isActive, true), eq(products.organizationId, organizationId)));
        return allProducts.filter(product => product.pricingFormula === template.formula);
    }

    // Email settings operations (tenant-scoped)
    async getAllEmailSettings(organizationId: string): Promise<EmailSettings[]> {
        return await this.dbInstance
            .select()
            .from(emailSettings)
            .where(and(eq(emailSettings.organizationId, organizationId), eq(emailSettings.isActive, true)))
            .orderBy(emailSettings.isDefault, emailSettings.createdAt);
    }

    async getEmailSettingsById(organizationId: string, id: string): Promise<EmailSettings | undefined> {
        const [settings] = await this.dbInstance
            .select()
            .from(emailSettings)
            .where(and(eq(emailSettings.id, id), eq(emailSettings.organizationId, organizationId)));
        return settings;
    }

    async getDefaultEmailSettings(organizationId: string): Promise<EmailSettings | undefined> {
        const [settings] = await this.dbInstance
            .select()
            .from(emailSettings)
            .where(and(eq(emailSettings.organizationId, organizationId), eq(emailSettings.isActive, true), eq(emailSettings.isDefault, true)))
            .limit(1);
        return settings;
    }

    async createEmailSettings(organizationId: string, settings: Omit<InsertEmailSettings, 'organizationId'>): Promise<EmailSettings> {
        // If this is set as default, unset all other defaults first within org
        if (settings.isDefault) {
            await this.dbInstance
                .update(emailSettings)
                .set({ isDefault: false, updatedAt: new Date() })
                .where(and(eq(emailSettings.isDefault, true), eq(emailSettings.organizationId, organizationId)));
        }

        const [newSettings] = await this.dbInstance
            .insert(emailSettings)
            .values({ ...settings, organizationId } as typeof emailSettings.$inferInsert)
            .returning();
        return newSettings;
    }

    async updateEmailSettings(organizationId: string, id: string, settingsData: Partial<Omit<InsertEmailSettings, 'organizationId'>>): Promise<EmailSettings> {
        // If this is being set as default, unset all other defaults first within org
        if (settingsData.isDefault) {
            await this.dbInstance
                .update(emailSettings)
                .set({ isDefault: false, updatedAt: new Date() })
                .where(and(eq(emailSettings.isDefault, true), eq(emailSettings.organizationId, organizationId), sql`${emailSettings.id} != ${id}`));
        }

        const updateData = settingsData;

        const [updated] = await this.dbInstance
            .update(emailSettings)
            .set(updateData)
            .where(and(eq(emailSettings.id, id), eq(emailSettings.organizationId, organizationId)))
            .returning();
        return updated;
    }

    async deleteEmailSettings(organizationId: string, id: string): Promise<void> {
        await this.dbInstance.delete(emailSettings).where(and(eq(emailSettings.id, id), eq(emailSettings.organizationId, organizationId)));
    }

    // Company settings operations (tenant-scoped)
    async getCompanySettings(organizationId: string): Promise<CompanySettings | undefined> {
        const [settings] = await this.dbInstance.select().from(companySettings).where(eq(companySettings.organizationId, organizationId)).limit(1);
        return settings;
    }

    async createCompanySettings(organizationId: string, settingsData: Omit<InsertCompanySettings, 'organizationId'>): Promise<CompanySettings> {
        const [settings] = await this.dbInstance.insert(companySettings).values({ ...settingsData, organizationId }).returning();
        if (!settings) {
            throw new Error("Failed to create company settings");
        }
        return settings;
    }

    async updateCompanySettings(organizationId: string, id: string, settingsData: Partial<Omit<InsertCompanySettings, 'organizationId'>>): Promise<CompanySettings> {
        const [updated] = await this.dbInstance
            .update(companySettings)
            .set(settingsData)
            .where(and(eq(companySettings.id, id), eq(companySettings.organizationId, organizationId)))
            .returning();

        if (!updated) {
            throw new Error("Company settings not found");
        }

        return updated;
    }
}
