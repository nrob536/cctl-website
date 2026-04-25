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
          .eq('available', true)
          .order('name')

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
      const uniqueCategories = [...new Set(this.toys.map(toy => toy.category))].filter(Boolean).sort()
      this.categories = uniqueCategories
    },

    get filteredToys() {
      if (!this.selectedCategory) return this.toys
      return this.toys.filter(toy => toy.category === this.selectedCategory)
    }
  }))
})

// Initialize Alpine on load
document.addEventListener('DOMContentLoaded', () => {
  if (!document.querySelector('[x-data]')) {
    // If Alpine data binding isn't on page, add it to body for manual init
    const container = document.querySelector('.container')
    if (container) {
      container.setAttribute('x-data', 'catalogue()')
      container.setAttribute('@init', 'init()')
    }
  }
})

// Manual initialization
Alpine.store('catalogue', {
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
        .eq('available', true)
        .order('name')

      if (error) throw error

      this.toys = data || []
      this.extractCategories()
      this.updateUI()
    } catch (err) {
      console.error('Error fetching toys:', err)
      this.toys = []
      this.updateUI()
    } finally {
      this.loading = false
      this.updateUI()
    }
  },

  extractCategories() {
    const uniqueCategories = [...new Set(this.toys.map(toy => toy.category))].filter(Boolean).sort()
    this.categories = uniqueCategories
  },

  updateUI() {
    Alpine.nextTick(() => {
      // Trigger Alpine reactivity update
    })
  }
})

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('library-name').textContent = LIBRARY_NAME

  try {
    const { data, error } = await window.db
      .from('toys')
      .select('*')
      .eq('available', true)
      .order('name')

    if (error) throw error

    const toys = data || []
    const categories = [...new Set(toys.map(toy => toy.category))].filter(Boolean).sort()

    // Create Alpine component
    const app = Alpine.reactive({
      toys: toys,
      categories: categories,
      loading: false,
      selectedCategory: '',
      get filteredToys() {
        if (!this.selectedCategory) return this.toys
        return this.toys.filter(toy => toy.category === this.selectedCategory)
      }
    })

    // Bind to page
    const filterSelect = document.getElementById('category-filter')
    const toysGrid = document.querySelector('.toys-grid')
    const loadingDiv = document.querySelector('.loading')

    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        app.selectedCategory = e.target.value
        renderToys()
      })
    }

    function renderToys() {
      if (toysGrid) {
        toysGrid.innerHTML = app.filteredToys.map(toy => `
          <div class="toy-card">
            <img src="${toy.image_url || 'images/placeholder.png'}" alt="${toy.name}" onerror="this.src='images/placeholder.png'">
            <div class="toy-card-content">
              <h3>${toy.name}</h3>
              <div class="toy-card-meta">
                <strong>Age Range:</strong> ${toy.age_range}
              </div>
              <span class="toy-card-category">${toy.category}</span>
              <br>
              <span class="badge-available" style="${toy.available ? '' : 'display:none'}">Available</span>
              <span class="badge-unavailable" style="${!toy.available ? '' : 'display:none'}">Currently Unavailable</span>
              <br>
              <a class="toy-card-link" href="toy.html?id=${toy.id}">View Details</a>
            </div>
          </div>
        `).join('')
      }

      if (app.filteredToys.length === 0 && loadingDiv) {
        loadingDiv.style.display = 'none'
        if (toysGrid) {
          toysGrid.innerHTML = '<div class="message message-info"><p>No toys found in this category. Please try another.</p></div>'
        }
      } else if (loadingDiv) {
        loadingDiv.style.display = 'none'
      }
    }

    renderToys()

    // Populate category filter
    if (filterSelect) {
      const options = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')
      filterSelect.innerHTML = '<option value="">All Categories</option>' + options
    }

  } catch (err) {
    console.error('Error fetching toys:', err)
    const loadingDiv = document.querySelector('.loading')
    if (loadingDiv) {
      loadingDiv.innerHTML = '<div class="message message-error"><p>Error loading toys. Please refresh the page.</p></div>'
    }
  }
})
