// Catalogue page logic
document.addEventListener('alpine:init', () => {
  const DEFAULT_DISPLAY_LIMIT = 25
  const DISPLAY_LIMIT_OPTIONS = [25, 50, 100]
  const CACHE_TTL_MS = 60 * 60 * 1000
  const CACHE_PREFIX = 'cctl_catalogue_sample_v3'

  Alpine.data('catalogue', () => ({
    toys: [],
    loading: true,
    displayLimit: DEFAULT_DISPLAY_LIMIT,
    displayLimitOptions: DISPLAY_LIMIT_OPTIONS,
    warningMessage: '',
    errorMessage: '',

    async init() {
      document.getElementById('library-name').textContent = LIBRARY_NAME
      await this.fetchToys()
    },

    get cacheKey() {
      return `${CACHE_PREFIX}:${this.displayLimit}`
    },

    readCache(allowStale = false) {
      try {
        const raw = localStorage.getItem(this.cacheKey)
        if (!raw) return null

        const cached = JSON.parse(raw)
        if (!cached || !Array.isArray(cached.toys) || !cached.timestamp) return null

        const isFresh = Date.now() - cached.timestamp < CACHE_TTL_MS
        if (!isFresh && !allowStale) return null

        return cached
      } catch (err) {
        console.warn('Error reading catalogue cache:', err)
        return null
      }
    },

    writeCache(toys) {
      try {
        localStorage.setItem(
          this.cacheKey,
          JSON.stringify({
            toys,
            timestamp: Date.now()
          })
        )
      } catch (err) {
        console.warn('Error writing catalogue cache:', err)
      }
    },

    async fetchToys() {
      try {
        this.loading = true
        this.warningMessage = ''
        this.errorMessage = ''

        const cached = this.readCache(false)
        if (cached) {
          this.toys = cached.toys
          return
        }

        const { data, error } = await window.db.rpc('sample_toys_round_robin', {
          p_limit: this.displayLimit
        })

        if (error) throw error

        this.toys = (data || []).filter((toy) => toy.available)
        this.writeCache(this.toys)
      } catch (err) {
        console.error('Error fetching toys:', err)
        const staleCache = this.readCache(true)

        if (staleCache) {
          this.toys = staleCache.toys
          this.warningMessage = 'Live catalogue data is temporarily unavailable. Showing cached toys.'
          return
        }

        this.toys = []
        this.errorMessage = 'Catalogue is temporarily unavailable. Please try again soon.'
      } finally {
        this.loading = false
      }
    },

    async onDisplayLimitChange() {
      await this.fetchToys()
    }
  }))
})
