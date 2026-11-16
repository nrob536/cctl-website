// Toy detail page logic (read-only: toys are borrowed in person)
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('library-name').textContent = LIBRARY_NAME

  // Get toy ID from URL query string
  const params = new URLSearchParams(window.location.search)
  const toyId = params.get('id')

  if (!toyId) {
    showError('No toy specified.')
    return
  }

  try {
    // Fetch toy details
    const { data: toy, error } = await window.db
      .from('toys')
      .select('*')
      .eq('id', toyId)
      .single()

    if (error || !toy) {
      showError('Toy not found.')
      return
    }

    // Display toy details
    displayToy(toy)
  } catch (err) {
    console.error('Error loading toy:', err)
    showError('Error loading toy details. Please try again.')
  }
})

function displayToy(toy) {
  document.getElementById('toy-name').textContent = toy.name
  document.getElementById('toy-description').textContent = toy.description || 'No description available.'
  document.getElementById('toy-age-range').textContent = toy.age_range || 'Not specified'
  document.getElementById('toy-category').textContent = toy.category || 'Uncategorized'
  document.getElementById('toy-public-id').textContent = getToyPublicId(toy) || 'N/A'
  
  const img = document.getElementById('toy-image')
  img.src = toy.image_url || 'images/placeholder.png'
  img.alt = toy.name

  document.getElementById('loading').style.display = 'none'
  document.getElementById('toy-detail').style.display = 'block'

  if (!toy.available) {
    document.getElementById('unavailable-msg').style.display = 'block'
  }
}

function showError(message) {
  document.getElementById('loading').style.display = 'none'
  const errorDiv = document.getElementById('toy-not-found')
  errorDiv.textContent = message
  errorDiv.style.display = 'block'
}

function getToyPublicId(toy) {
  if (!toy || typeof toy !== 'object') return ''

  const candidates = [toy.ID, toy.toy_public_id, toy.public_id]
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue
    const text = String(candidate).trim()
    if (text) return text
  }

  return ''
}
