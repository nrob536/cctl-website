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
  document.getElementById('toy-public-id').textContent = getToyPublicId(toy) || 'N/A'
  
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

    // Resolve canonical toy ID then create booking through RPC.
    const { toyId, resolutionError } = await resolveBookingToyId(toy)

    if (resolutionError || !toyId) {
      showFormMessage('We could not match this toy to a bookable record. Please refresh the catalogue and try again.', 'error', formMessage)
      submitBtn.disabled = false
      submitBtn.textContent = 'Book This Toy'
      return
    }

    let { data: bookingRows, error: bookingError } = await createBooking(resolvedUserId, toyId, pickupDate)

    // If identifiers are out-of-sync, retry once after resolving by toy attributes.
    const needsRetry = isToyForeignKeyError(bookingError)
    if (needsRetry) {
      const { toyId: retryToyId } = await resolveBookingToyId(toy, { forceLookup: true })
      if (retryToyId && retryToyId !== toyId) {
        const retryResult = await createBooking(resolvedUserId, retryToyId, pickupDate)
        bookingRows = retryResult.data
        bookingError = retryResult.error
      }
    }

    if (bookingError) {
      const code = String(bookingError.message || '')
      const lowered = code.toLowerCase()

      if (code.includes('MAX_ACTIVE_BOOKINGS')) {
        showFormMessage('You have reached the maximum number of active bookings (3). Please return a toy before booking another.', 'error', formMessage)
      } else if (code.includes('MEMBER_BLOCKED')) {
        showFormMessage('Your account is blocked. Please contact the library staff.', 'error', formMessage)
      } else if (code.includes('TOY_UNAVAILABLE')) {
        showFormMessage('Sorry, this toy is no longer available.', 'error', formMessage)
      } else if (
        code.includes('TOY_NOT_FOUND') ||
        lowered.includes('bookings_toy_id_fkey') ||
        (lowered.includes('foreign key') && lowered.includes('toy_id'))
      ) {
        showFormMessage('This toy could not be matched to a valid booking record. Please refresh the catalogue and try again. If it still fails, ask staff to check toy IDs in Supabase.', 'error', formMessage)
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

function isUuid(value) {
  const text = String(value || '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
}

function pickUuidFromToyObject(toy) {
  if (!toy || typeof toy !== 'object') return ''

  const directCandidates = [toy.id, toy.toy_id, toy.toy_uuid, toy.uuid]
  for (const candidate of directCandidates) {
    if (isUuid(candidate)) return String(candidate).trim()
  }

  return ''
}

async function resolveBookingToyId(toy, options = {}) {
  const preferredId = pickUuidFromToyObject(toy)
  const forceLookup = Boolean(options.forceLookup)

  if (preferredId && !forceLookup) {
    return { toyId: preferredId, resolutionError: null }
  }

  const toyName = String(toy && toy.name ? toy.name : '').trim()
  const toyCategory = String(toy && toy.category ? toy.category : '').trim()

  if (!toyName) {
    return { toyId: '', resolutionError: new Error('MISSING_TOY_NAME') }
  }

  let query = window.db
    .from('toys')
    .select('id,name,category,available,created_at')
    .eq('name', toyName)
    .order('available', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10)

  if (toyCategory) {
    query = query.eq('category', toyCategory)
  }

  const { data, error } = await query
  if (error) {
    return { toyId: '', resolutionError: error }
  }

  const rows = Array.isArray(data) ? data : []
  if (rows.length === 0) {
    return { toyId: preferredId, resolutionError: preferredId ? null : new Error('TOY_MATCH_NOT_FOUND') }
  }

  const activeCandidate = rows.find((row) => row && row.available && isUuid(row.id))
  if (activeCandidate) {
    return { toyId: String(activeCandidate.id), resolutionError: null }
  }

  const anyCandidate = rows.find((row) => row && isUuid(row.id))
  if (anyCandidate) {
    return { toyId: String(anyCandidate.id), resolutionError: null }
  }

  return { toyId: preferredId, resolutionError: preferredId ? null : new Error('TOY_UUID_NOT_FOUND') }
}

function isToyForeignKeyError(error) {
  if (!error) return false
  const message = String(error.message || '').toLowerCase()
  return message.includes('bookings_toy_id_fkey') || (message.includes('foreign key') && message.includes('toy_id'))
}

async function createBooking(userId, toyId, pickupDate) {
  const payload = {
    p_user_id: userId,
    p_toy_id: toyId,
    p_pickup_date: pickupDate
  }

  const v2Result = await window.db.rpc('create_booking_v2', payload)
  if (!isMissingFunctionError(v2Result.error)) {
    return v2Result
  }

  return window.db.rpc('create_booking', payload)
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

function isMissingFunctionError(error) {
  if (!error) return false
  const message = String(error.message || '').toLowerCase()
  return (
    (message.includes('function') && message.includes('does not exist')) ||
    (message.includes('could not find the function') && message.includes('schema cache'))
  )
}
