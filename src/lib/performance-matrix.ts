import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_PERFORMANCE_CATEGORIES = [
  { category_key: "financial_stewardship", label: "Financial Stewardship and Discipline", recommended_weight: 20, sort_order: 1, description: null, guidance: null },
  { category_key: "service_delivery", label: "Service Delivery", recommended_weight: 25, sort_order: 2, description: null, guidance: null },
  { category_key: "institutional_transformation", label: "Institutional Transformation", recommended_weight: 20, sort_order: 3, description: null, guidance: null },
  { category_key: "core_mandate", label: "Core Mandate", recommended_weight: 25, sort_order: 4, description: null, guidance: null },
  { category_key: "cross_cutting", label: "Cross-Cutting Issues", recommended_weight: 10, sort_order: 5, description: null, guidance: null },
] as const;

const DEFAULT_STATUS_OPTIONS = [
  { label: "Not Started", sort_order: 1 },
  { label: "In Progress", sort_order: 2 },
  { label: "Completed", sort_order: 3 },
  { label: "Ongoing", sort_order: 4 },
  { label: "Delayed", sort_order: 5 },
  { label: "Deferred", sort_order: 6 },
] as const;

function normalizeDepartment(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function filterByDepartment<T extends Record<string, unknown>>(rows: T[] | null | undefined, department?: string | null) {
  if (!rows) return [] as T[];
  const normalizedDepartment = normalizeDepartment(department);
  if (!normalizedDepartment) return rows;
  return rows.filter((row) => normalizeDepartment(row.department as string | null | undefined) === normalizedDepartment);
}

export async function loadPerformanceMatrixState(
  supabaseClient: SupabaseClient,
  department?: string | null,
  options: { includeInactive?: boolean } = {},
) {
  const dept = (department ?? "").trim();
  const includeInactive = options.includeInactive ?? true;

  const matrixQuery = supabaseClient.from("performance_matrix").select("*").order("sort_order", { ascending: true });
  const sourceQuery = supabaseClient.from("matrix_sources").select("*").order("sort_order", { ascending: true });
  const categoryQuery = supabaseClient.from("performance_categories").select("*").order("sort_order", { ascending: true });
  const statusQuery = supabaseClient.from("matrix_status_options").select("*").order("sort_order", { ascending: true });

  if (dept) {
    matrixQuery.eq("department", dept);
    sourceQuery.eq("department", dept);
    categoryQuery.eq("department", dept);
    statusQuery.eq("department", dept);
  }

  if (!includeInactive) {
    matrixQuery.eq("is_active", true);
    sourceQuery.eq("is_active", true);
    categoryQuery.eq("is_active", true);
    statusQuery.eq("is_active", true);
  }

  const [{ data: matrixRows }, { data: sourceRows }, { data: categoryRows }, { data: statusRows }] = await Promise.all([
    matrixQuery,
    sourceQuery,
    categoryQuery,
    statusQuery,
  ]);

  const filteredCategories = filterByDepartment(categoryRows as Array<Record<string, unknown>>, department);
  const filteredStatuses = filterByDepartment(statusRows as Array<Record<string, unknown>>, department);

  if (department && filteredCategories.length === 0) {
    const toInsert = DEFAULT_PERFORMANCE_CATEGORIES.map((category, index) => ({
      department: department.trim(),
      category_key: category.category_key,
      label: category.label,
      recommended_weight: category.recommended_weight,
      description: category.description,
      guidance: category.guidance,
      sort_order: index + 1,
      is_active: true,
    }));
    await supabaseClient.from("performance_categories").insert(toInsert);
  } else if (department) {
    const existingKeys = new Set(filteredCategories.map((category) => String(category.category_key)));
    const missing = DEFAULT_PERFORMANCE_CATEGORIES.filter((category) => !existingKeys.has(category.category_key));
    if (missing.length > 0) {
      const toInsert = missing.map((category, index) => ({
        department: department.trim(),
        category_key: category.category_key,
        label: category.label,
        recommended_weight: category.recommended_weight,
        description: category.description,
        guidance: category.guidance,
        sort_order: (filteredCategories.length ?? 0) + index + 1,
        is_active: true,
      }));
      await supabaseClient.from("performance_categories").insert(toInsert);
    }
  }

  if (department && filteredStatuses.length === 0) {
    const toInsert = DEFAULT_STATUS_OPTIONS.map((option) => ({ department: department.trim(), label: option.label, sort_order: option.sort_order, is_active: true }));
    await supabaseClient.from("matrix_status_options").insert(toInsert);
  }

  const refreshedCategories = await supabaseClient.from("performance_categories").select("*").order("sort_order", { ascending: true });
  const refreshedStatuses = await supabaseClient.from("matrix_status_options").select("*").order("sort_order", { ascending: true });

  return {
    matrixRows: filterByDepartment(matrixRows as Array<Record<string, unknown>>, department),
    sourceRows: filterByDepartment(sourceRows as Array<Record<string, unknown>>, department),
    categories: filterByDepartment(refreshedCategories.data as Array<Record<string, unknown>> | null, department),
    statusRows: filterByDepartment(refreshedStatuses.data as Array<Record<string, unknown>> | null, department),
  };
}
