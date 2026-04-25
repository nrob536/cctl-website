// Catalogue page logic
document.addEventListener('alpine:init', () => {
  Alpine.data('catalogue', () => ({
    toys: [],
    categories: [],
    loading: true,
    selectedCategory: '',

    async init() {
      document.getElementById('library-name').textContent = LIBRARY_NAME
      await this.fetchToys()
    },

    async fetchToys() {
      try {
        this.loading = true

        const { data, error } = await window.db
          .from('toys')
          .select('*')
          .order('name', { ascending: true })

        if (error) throw error

        this.toys = data || []
        this.extractCategories()
      } catch (err) {
        console.error('Error fetching toys:', err)
        this.toys = []
      } finally {
        this.loading = false
      }
    },

    extractCategories() {
      const uniqueCategories = [...new Set(this.toys.map((toy) => toy.category))]
        .filter(Boolean)
        .sort()
      this.categories = uniqueCategories
    },

    get filteredToys() {
      if (!this.selectedCategory) return this.toys
      return this.toys.filter((toy) => toy.category === this.selectedCategory)
    }
  }))
})
