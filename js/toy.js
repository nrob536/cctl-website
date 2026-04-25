// Toy detail and booking page logic
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

    // Set minimum pickup date to today
    const pickupInput = document.getElementById('pickup-date')
    const today = new Date().toISOString().split('T')[0]
    pickupInput.min = today
    pickupInput.value = today

    // Handle booking form submission
    const form = document.getElementById('booking-form')
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      await handleBookingSubmit(toy)
    })
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
  
  const img = document.getElementById('toy-image')
  img.src = toy.image_url || 'images/placeholder.png'
  img.alt = toy.name

  document.getElementById('loading').style.display = 'none'
  document.getElementById('toy-detail').style.display = 'block'

  if (toy.available) {
    document.getElementById('booking-form-container').style.display = 'block'
  } else {
    document.getElementById('unavailable-msg').style.display = 'block'
  }
}

async function handleBookingSubmit(toy) {
  const rawUserId = document.getElementById('user-id').value
  const userIdCandidates = buildUserIdCandidates(rawUserId)
  const userId = userIdCandidates[0] || ''
  const pickupDate = document.getElementById('pickup-date').value
  const submitBtn = document.getElementById('submit-btn')
  const formMessage = document.getElementById('form-message')

  if (!userId || !pickupDate) {
    showFormMessage('Please fill in all fields.', 'error', formMessage)
    return
  }

  submitBtn.disabled = true
  submitBtn.textContent = 'Processing...'

  // Keep the field tidy without forcing case changes.
  document.getElementById('user-id').value = userId

  try {
    // Look up member through RPC (members table is not directly readable by client).
    const { member, memberError } = await lookupMemberByCandidates(userIdCandidates)

    if (memberError || !member) {
      showFormMessage('User ID not found. Please check and try again.', 'error', formMessage)
      submitBtn.disabled = false
      submitBtn.textContent = 'Book This Toy'
      return
    }

    // Check if member is blocked
    if (member.is_blocked) {
      showFormMessage('Your account is blocked. Please contact the library staff.', 'error', formMessage)
      submitBtn.disabled = false
      submitBtn.textContent = 'Book This Toy'
      return
    }

    const resolvedUserId = member.user_id || userId

    // Create booking through RPC (enforces blocked/max-active/toy-availability server-side)
    const { data: bookingRows, error: bookingError } = await window.db
      .rpc('create_booking', {
        p_user_id: resolvedUserId,
        p_toy_id: toy.id,
        p_pickup_date: pickupDate
      })

    if (bookingError) {
      const code = String(bookingError.message || '')
      const lowered = code.toLowerCase()

      if (code.includes('MAX_ACTIVE_BOOKINGS')) {
        showFormMessage('You have reached the maximum number of active bookings (3). Please return a toy before booking another.', 'error', formMessage)
      } else if (code.includes('MEMBER_BLOCKED')) {
        showFormMessage('Your account is blocked. Please contact the library staff.', 'error', formMessage)
      } else if (code.includes('TOY_UNAVAILABLE')) {
        showFormMessage('Sorry, this toy is no longer available.', 'error', formMessage)
      } else if (code.includes('MEMBER_NOT_FOUND')) {
        showFormMessage('User ID not found. Please check and try again.', 'error', formMessage)
      } else if (lowered.includes('row-level security') || lowered.includes('permission denied')) {
        showFormMessage('Booking is blocked by database permissions. Please ask staff to check the create_booking function permissions (SECURITY DEFINER and GRANT EXECUTE).', 'error', formMessage)
      } else if (
        (lowered.includes('function') && lowered.includes('create_booking') && lowered.includes('does not exist')) ||
        (lowered.includes('could not find the function') && lowered.includes('create_booking') && lowered.includes('schema cache'))
      ) {
        showFormMessage('Booking service is not configured in Supabase yet. Please ask staff to create the create_booking database function.', 'error', formMessage)
      } else {
        const detail = sanitizeErrorMessage(code)
        showFormMessage(`Booking failed: ${detail}`, 'error', formMessage)
      }

      submitBtn.disabled = false
      submitBtn.textContent = 'Book This Toy'
      return
    }

    const booking = toSingleRow(bookingRows)
    const dueDateString = booking ? booking.due_date : null

    // Show success message
    showFormMessage(`Booking successful! Please pick up ${toy.name} by ${formatDate(dueDateString)}.`, 'success', formMessage)
    
    // Reset form
    document.getElementById('booking-form').reset()
    submitBtn.disabled = false
    submitBtn.textContent = 'Book This Toy'

    // Redirect after 3 seconds
    setTimeout(() => {
      window.location.href = 'my-bookings.html'
    }, 3000)

  } catch (err) {
    console.error('Error creating booking:', err)
    const detail = sanitizeErrorMessage(err && err.message ? err.message : '')
    showFormMessage(`Error booking toy. ${detail}`, 'error', formMessage)
    submitBtn.disabled = false
    submitBtn.textContent = 'Book This Toy'
  }
}

function showError(message) {
  document.getElementById('loading').style.display = 'none'
  const errorDiv = document.getElementById('toy-not-found')
  errorDiv.textContent = message
  errorDiv.style.display = 'block'
}

function showFormMessage(message, type, container) {
  container.innerHTML = `<div class="message message-${type}">${message}</div>`
}

function formatDate(dateString) {
  if (!dateString) {
    return '14 days from booking'
  }
  const date = new Date(dateString)
  return date.toLocaleDateString('en-NZ', { year: 'numeric', month: 'long', day: 'numeric' })
}

function toSingleRow(data) {
  if (!data) return null
  if (Array.isArray(data)) return data.length > 0 ? data[0] : null
  if (typeof data === 'object') return data
  return null
}

function normalizeUserId(userId) {
  return String(userId || '').trim()
}

function buildUserIdCandidates(userId) {
  const base = normalizeUserId(userId)
  if (!base) return []

  const variants = [base, base.toUpperCase(), base.toLowerCase()]
  return [...new Set(variants)]
}

async function lookupMemberByCandidates(candidates) {
  let lastError = null

  for (const candidate of candidates) {
    const { data, error } = await window.db.rpc('lookup_member', { p_user_id: candidate })
    const member = toSingleRow(data)

    if (member) {
      return { member, memberError: null }
    }

    if (error) {
      lastError = error
    }
  }

  return { member: null, memberError: lastError }
}

function sanitizeErrorMessage(message) {
  const fallback = 'Please try again, or contact staff if this continues.'
  if (!message) return fallback

  const trimmed = String(message).replace(/\s+/g, ' ').trim()
  if (!trimmed) return fallback

  // Keep frontend errors readable and avoid dumping long SQL traces to users.
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed
}
