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
  const userId = document.getElementById('user-id').value.trim()
  const pickupDate = document.getElementById('pickup-date').value
  const submitBtn = document.getElementById('submit-btn')
  const formMessage = document.getElementById('form-message')

  if (!userId || !pickupDate) {
    showFormMessage('Please fill in all fields.', 'error', formMessage)
    return
  }

  submitBtn.disabled = true
  submitBtn.textContent = 'Processing...'

  try {
    // Look up member through RPC (members table is not directly readable by client)
    const { data: memberRows, error: memberError } = await window.db
      .rpc('lookup_member', { p_user_id: userId })

    const member = memberRows && memberRows.length > 0 ? memberRows[0] : null

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

    // Create booking through RPC (enforces blocked/max-active/toy-availability server-side)
    const { data: bookingRows, error: bookingError } = await window.db
      .rpc('create_booking', {
        p_user_id: userId,
        p_toy_id: toy.id,
        p_pickup_date: pickupDate
      })

    if (bookingError) {
      const code = String(bookingError.message || '')
      if (code.includes('MAX_ACTIVE_BOOKINGS')) {
        showFormMessage('You have reached the maximum number of active bookings (3). Please return a toy before booking another.', 'error', formMessage)
      } else if (code.includes('MEMBER_BLOCKED')) {
        showFormMessage('Your account is blocked. Please contact the library staff.', 'error', formMessage)
      } else if (code.includes('TOY_UNAVAILABLE')) {
        showFormMessage('Sorry, this toy is no longer available.', 'error', formMessage)
      } else if (code.includes('MEMBER_NOT_FOUND')) {
        showFormMessage('User ID not found. Please check and try again.', 'error', formMessage)
      } else {
        throw bookingError
      }

      submitBtn.disabled = false
      submitBtn.textContent = 'Book This Toy'
      return
    }

    const dueDateString = bookingRows && bookingRows[0] ? bookingRows[0].due_date : null

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
    showFormMessage('Error booking toy. Please try again.', 'error', formMessage)
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
