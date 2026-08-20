// Catalogue page logic
document.addEventListener('alpine:init', () => {
  Alpine.data('catalogue', () => ({
    toys: [],
    categories: [],
    loading: true,
    selectedCategory: '',
    defaultCategory: '',
    displaySize: 25,
    displayOptions: [25, 50, 100],
    loadedCount: 0,

    async init() {
      document.getElementById('library-name').textContent = LIBRARY_NAME
      await this.fetchCategories()
      await this.fetchToys()
    },

    async onCategoryChange() {
      await this.fetchToys()
    },

    async onDisplaySizeChange() {
      await this.fetchToys()
    },

    async fetchCategories() {
      const { data, error } = await window.db.rpc('list_toy_categories')

      if (error) {
        const fallback = await this.fetchCategoriesFallback()
        this.categories = fallback
      } else {
        const rows = Array.isArray(data) ? data : []
        this.categories = rows
          .map((row) => String(row.category || '').trim())
          .filter(Boolean)

        const defaultRow = rows.find((row) => row && row.is_default)
        this.defaultCategory = defaultRow && defaultRow.category ? String(defaultRow.category) : (this.categories[0] || '')
      }

      if (!this.defaultCategory && this.categories.length > 0) {
        this.defaultCategory = this.categories[0]
      }

      if (!this.selectedCategory && this.defaultCategory) {
        this.selectedCategory = this.defaultCategory
      }
    },

    async fetchCategoriesFallback() {
      const { data, error } = await window.db
        .from('toys')
        .select('category')
        .order('category', { ascending: true })
        .limit(400)

      if (error) throw error

      const unique = [...new Set((Array.isArray(data) ? data : []).map((row) => this.normalizeCategory(row && row.category)))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))

      this.defaultCategory = unique[0] || ''
      return unique
    },

    async fetchToys() {
      try {
        this.loading = true
        const limit = Number(this.displaySize) || 25

        const { data, error } = await window.db.rpc('get_balanced_toys', {
          p_limit: limit,
          p_category: this.selectedCategory || null,
          p_default_category: this.defaultCategory || null
        })

        if (error) {
          // Graceful fallback while the RPC migration is being rolled out.
          const fallbackRows = await this.fetchToysFallback(limit, this.selectedCategory || this.defaultCategory)
          this.toys = fallbackRows
          this.loadedCount = this.toys.length
          return
        }

        const rows = Array.isArray(data) ? data : []
        this.toys = rows.map((toy) => this.normalizeToyRecord(toy))
        this.loadedCount = this.toys.length
      } catch (err) {
        console.error('Error fetching toys:', err)
        this.toys = []
        this.loadedCount = 0
      } finally {
        this.loading = false
      }
    },

    async fetchToysFallback(limit, category) {
      const fetchLimit = Math.min(600, Math.max(limit * 6, 150))

      const { data, error } = await window.db
        .from('toys')
        .select('id,"ID",name,description,category,age_range,image_url,available,created_at')
        .order('name', { ascending: true })
        .limit(fetchLimit)

      if (error) throw error

      const selectedCategory = this.normalizeCategory(category)
      const sourceRows = (Array.isArray(data) ? data : []).map((toy) => this.normalizeToyRecord(toy))
      return sourceRows
        .filter((toy) => this.normalizeCategory(toy.category) === selectedCategory)
        .slice(0, limit)
    },

    normalizeToyRecord(toy) {
      return {
        ...toy,
        category: this.normalizeCategory(toy && toy.category),
        toy_public_id: toy && (toy.toy_public_id ?? toy.ID ?? toy.id_numeric ?? null)
      }
    },

    normalizeCategory(category) {
      const text = String(category || '').trim()
      return text || 'Uncategorized'
    },

    get filteredToys() {
      return this.toys
    }
  }))
})
