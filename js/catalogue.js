// Catalogue page logic
document.addEventListener('alpine:init', () => {
  Alpine.data('catalogue', () => ({
    toys: [],
    categories: [],
    selectedCategory: '',
    defaultCategory: '',
    loading: true,
    error: null,
    cache: {},       // toys already loaded, keyed by category
    requestId: 0,    // ignores out-of-date responses if the user clicks quickly

    async init() {
      document.getElementById('library-name').textContent = LIBRARY_NAME

      try {
        await this.fetchCategories()
      } catch (err) {
        console.error('Error loading categories:', err)
        this.error = 'Sorry, we could not load the toy categories. Please try again later.'
        this.loading = false
        return
      }

      await this.loadToys(this.selectedCategory)
    },

    // Called when the user picks a category in the dropdown
    async selectCategory(category) {
      this.selectedCategory = category
      await this.loadToys(category)
    },

    async fetchCategories() {
      let names = []
      let defaultName = ''

      const { data, error } = await window.db.rpc('list_toy_categories')

      if (!error && Array.isArray(data) && data.length > 0) {
        names = data
          .map((row) => String(row.category || '').trim())
          .filter(Boolean)
        const defaultRow = data.find((row) => row && row.is_default)
        defaultName = defaultRow && defaultRow.category ? String(defaultRow.category).trim() : ''
      } else {
        // Fallback: read categories straight from the toys table
        const result = await window.db.from('toys').select('category')
        if (result.error) throw result.error
        names = [...new Set((result.data || []).map((row) => this.normalizeCategory(row.category)))]
          .sort((a, b) => a.localeCompare(b))
      }

      if (names.length === 0) throw new Error('No categories found')

      this.defaultCategory = names.includes(defaultName) ? defaultName : names[0]
      // Set the selection first so the dropdown shows it when the options render
      this.selectedCategory = this.defaultCategory
      this.categories = names
    },

    async loadToys(category) {
      this.error = null

      // Already loaded this category? Show it instantly, no backend request.
      if (this.cache[category]) {
        this.toys = this.cache[category]
        this.loading = false
        return
      }

      const thisRequest = ++this.requestId
      this.loading = true

      try {
        let query = window.db
          .from('toys')
          .select('*')
          .order('name', { ascending: true })

        if (category === 'Uncategorized') {
          query = query.or('category.is.null,category.eq.')
        } else {
          query = query.eq('category', category)
        }

        const { data, error } = await query
        if (error) throw error
        if (thisRequest !== this.requestId) return

        const rows = (data || []).map((toy) => this.normalizeToyRecord(toy))
        this.cache[category] = rows
        this.toys = rows
      } catch (err) {
        if (thisRequest !== this.requestId) return
        console.error('Error fetching toys:', err)
        this.error = 'Sorry, we could not load the toys. Please try again later.'
        this.toys = []
      } finally {
        if (thisRequest === this.requestId) this.loading = false
      }
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
    }
  }))
})