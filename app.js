(function () {
  'use strict';

  // ---------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------
  var state = {
    config: null,
    properties: [],
    allProperties: [],
    activeDestination: 'Sakleshpur',
    source: document.getElementById('urlSource').value || '',
    campaign: document.getElementById('urlCampaign').value || '',
    bookingSessionId: null,
    booking: { property: null, checkIn: '', checkOut: '', rooms: 1, adults: 2, children: 0, phoneVerified: false }
  };

  var KNOWN_DESTINATIONS = ['Sakleshpur', 'Kabini'];

  (function captureUrlParams() {
    try {
      var params = new URLSearchParams(window.location.search);
      state.source = state.source || params.get('source') || '';
      state.campaign = state.campaign || params.get('campaign') || '';
    } catch (e) { /* no-op */ }
  })();

  // ---------------------------------------------------------------
  // UTILITIES
  // ---------------------------------------------------------------
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function formatInr(n) { return '₹' + (Number(n) || 0).toLocaleString('en-IN'); }
  function todayStr() { return new Date().toISOString().substring(0, 10); }
  function addDays(dateStr, days) {
    var d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().substring(0, 10);
  }
  function newRequestId() { return 'req-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10); }
  function newSessionId() { return 'sess-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10); }
  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }
  function showToast(message, isError) {
    var container = document.getElementById('toastContainer');
    var toast = document.createElement('div');
    toast.className = 'toast';
    if (isError) toast.style.background = '#b3261e';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 4500);
  }
  function setLoading(btn, loading, labelWhileLoading) {
    if (!btn) return;
    if (loading) {
      btn.dataset.originalLabel = btn.dataset.originalLabel || btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> ' + (labelWhileLoading || 'Please wait…');
    } else {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalLabel || btn.innerHTML;
    }
  }

  /**
   * Promise wrapper around google.script.run. EVERY call goes through
   * .withSuccessHandler(...).withFailureHandler(...) as required — this
   * function is the single place that wiring lives, so no call can ever
   * accidentally skip a failure handler.
   *
   * Matches the server's {success, message, data} envelope from
   * safeRun_() in Utils.gs.
   */
  /**
   * Frontend transport for the Vercel-hosted site.
   *
   * IMPORTANT:
   * This is only a transport adapter for Stage 1.
   * Business logic remains in the existing Google Apps Script backend.
   * The browser calls the same-origin Vercel /api/appscript endpoint,
   * which forwards the request to Apps Script.
   */
  function callServer(fnName) {
    var args = Array.prototype.slice.call(arguments, 1);

    return fetch('/api/appscript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fnName: fnName,
        args: args
      })
    })
      .then(function (response) {
        return response.text().then(function (text) {
          var result;

          try {
            result = text ? JSON.parse(text) : null;
          } catch (e) {
            throw new Error('Backend returned an invalid response.');
          }

          if (!response.ok) {
            throw new Error(
              (result && (result.message || result.error)) ||
              'Backend request failed.'
            );
          }

          if (result && result.success === false) {
            console.error(
              '[' + fnName + '] server error:',
              result.message || result.error
            );
            throw new Error(
              result.message || result.error || 'Something went wrong.'
            );
          }

          return result &&
            Object.prototype.hasOwnProperty.call(result, 'data')
            ? result.data
            : result;
        });
      })
      .catch(function (err) {
        console.error('[' + fnName + '] transport error:', err);
        throw new Error(
          (err && err.message) ||
          'Something went wrong. Please try again.'
        );
      });
  }

  // ---------------------------------------------------------------
  // PRIVACY POLICY MODAL
  // ---------------------------------------------------------------
  function initPrivacyPolicyModal() {
    var overlay = document.getElementById('privacyModalOverlay');
    var closeBtn = document.getElementById('closePrivacyModal');
    if (!overlay) return;

    function openPrivacyModal(e) {
      if (e) e.preventDefault();
      overlay.classList.remove('hidden');
      document.body.classList.add('privacy-modal-open');
      if (window.history && window.history.replaceState) {
        try { window.history.replaceState(null, '', window.location.href.split('#')[0] + '#privacy-policy'); } catch (_) {}
      }
    }

    function closePrivacyModal(e) {
      if (e) e.preventDefault();
      overlay.classList.add('hidden');
      document.body.classList.remove('privacy-modal-open');
      if (window.history && window.history.replaceState) {
        try { window.history.replaceState(null, '', window.location.href.split('#')[0]); } catch (_) {}
      }
    }

    // Delegation is intentional: booking privacy links are created dynamically.
    document.addEventListener('click', function (e) {
      var link = e.target.closest ? e.target.closest('.js-open-privacy') : null;
      if (link) openPrivacyModal(e);
    });

    if (closeBtn) closeBtn.addEventListener('click', closePrivacyModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePrivacyModal(e);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closePrivacyModal(e);
    });
  }

  // ---------------------------------------------------------------
  // NAVIGATION
  // ---------------------------------------------------------------
  function initNav() {
    $all('a[data-section]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var sectionId = link.getAttribute('data-section');
        var destination = link.getAttribute('data-destination');
        var target = document.getElementById(sectionId);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
        setActiveNav(sectionId);
        document.getElementById('navDesktop').classList.remove('open');
        if (destination) selectDestination(destination);
      });
    });
    document.getElementById('navToggle').addEventListener('click', function () {
      document.getElementById('navDesktop').classList.toggle('open');
    });
    document.getElementById('bookStayBtn').addEventListener('click', function () {
      document.getElementById('hotels').scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('stickyBookBtn').addEventListener('click', function () {
      document.getElementById('hotels').scrollIntoView({ behavior: 'smooth' });
    });
  }
  function setActiveNav(sectionId) {
    $all('.nav-desktop a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-section') === sectionId);
    });
  }

  // ---------------------------------------------------------------
  // AUTOCOMPLETE (Agoda-style property/destination search)
  // ---------------------------------------------------------------
  function initAutocomplete() {
    var input = document.getElementById('destinationInput');
    var dropdown = document.getElementById('autocompleteDropdown');
    var highlightedIndex = -1;
    var currentSuggestions = [];

    var runSuggest = debounce(function (term) {
      if (!term || term.trim().length < 1) { closeDropdown(); return; }
      callServer('getPropertySuggestions', term)
        .then(function (suggestions) {
          currentSuggestions = suggestions || [];
          renderSuggestions(currentSuggestions, term);
        })
        .catch(function () { closeDropdown(); });
    }, 220);

    input.addEventListener('input', function () {
      document.getElementById('selectedPropertyId').value = '';
      highlightedIndex = -1;
      runSuggest(input.value);
    });

    input.addEventListener('focus', function () {
      if (input.value.trim().length > 0) runSuggest(input.value);
    });

    input.addEventListener('keydown', function (e) {
      var items = $all('.autocomplete-item', dropdown);
      if (!items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1); updateHighlight(items); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlightedIndex = Math.max(highlightedIndex - 1, 0); updateHighlight(items); }
      else if (e.key === 'Enter' && highlightedIndex >= 0) { e.preventDefault(); items[highlightedIndex].click(); }
      else if (e.key === 'Escape') { closeDropdown(); }
    });

    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target) && e.target !== input) closeDropdown();
    });

    function updateHighlight(items) {
      items.forEach(function (el, i) { el.classList.toggle('highlighted', i === highlightedIndex); });
    }

    function renderSuggestions(suggestions, term) {
      if (!suggestions.length) {
        // No property matched — still let the user search by destination text alone.
        var matchesKnownDestination = KNOWN_DESTINATIONS.some(function (d) {
          return d.toLowerCase().indexOf(term.trim().toLowerCase()) === 0;
        });
        dropdown.innerHTML = matchesKnownDestination
          ? ''
          : '<div class="autocomplete-empty">No matching VINJAB properties. Try "Sakleshpur", "Kabini", or a property name.</div>';
        if (!matchesKnownDestination) { dropdown.classList.remove('hidden'); } else { closeDropdown(); }
        return;
      }
      dropdown.innerHTML = suggestions.map(function (s, i) {
        return (
          '<div class="autocomplete-item" data-index="' + i + '" data-property-id="' + escapeHtml(s.propertyId) + '" data-destination="' + escapeHtml(s.destination) + '" data-name="' + escapeHtml(s.propertyName) + '">' +
            '<div class="name">' + escapeHtml(s.label) + '</div>' +
            '<div class="meta">' + escapeHtml(s.sublabel) + '</div>' +
          '</div>'
        );
      }).join('');
      dropdown.classList.remove('hidden');

      $all('.autocomplete-item', dropdown).forEach(function (item) {
        item.addEventListener('click', function () {
          var propertyId = item.getAttribute('data-property-id');
          var destination = item.getAttribute('data-destination');
          var name = item.getAttribute('data-name');
          input.value = name + ', ' + destination;
          document.getElementById('selectedPropertyId').value = propertyId;
          document.getElementById('selectedDestination').value = destination;
          closeDropdown();
        });
      });
    }

    function closeDropdown() {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
      highlightedIndex = -1;
    }
  }

  // ---------------------------------------------------------------
  // TRENDING CHIPS
  // ---------------------------------------------------------------
  /*
   * Trending chips are curated UI categories.
   *
   * IMPORTANT:
   * - Luxury Resorts keeps the existing featured-property behavior.
   * - Sakleshpur / Kabini remain real destination filters.
   * - Couple Stay = room-style properties / properties described for couples.
   * - Nature Resorts = properties whose type is Resort.
   * - Weekend Gateways = all resort properties (rooms excluded).
   *
   * We deliberately filter the properties already loaded on the home page.
   * This avoids another Apps Script round-trip and prevents the trending
   * buttons from falling back to broad keyword searches.
   */

  var TRENDING_CATEGORY_LABELS = [
    'Couple Stay',
    'Nature Resorts',
    'Weekend Gateways'
  ];

  function normalizeTrendingLabel(label) {
    var value = String(label == null ? '' : label).trim();
    var key = value.toLowerCase().replace(/\s+/g, ' ');

    // Canonical spelling used throughout the UI.
    if (
      key === 'weekend getaway' ||
      key === 'weekend getaways' ||
      key === 'weekend gateway' ||
      key === 'weekend gateways'
    ) {
      return 'Weekend Gateways';
    }

    if (key === 'couple stay' || key === 'couples stay') {
      return 'Couple Stay';
    }

    if (key === 'nature resort' || key === 'nature resorts') {
      return 'Nature Resorts';
    }

    if (key === 'luxury resort' || key === 'luxury resorts') {
      return 'Luxury Resorts';
    }

    if (key === 'sakleshpur') return 'Sakleshpur';
    if (key === 'kabini') return 'Kabini';

    return value;
  }

  function initTrendingChips() {
    var container = document.getElementById('trendingChips');

    if (!container) return;

    container.innerHTML = '';

    var configuredSearches =
      (state.config && state.config.trendingSearches) || [];

    var uniqueSearches = [];

    configuredSearches.forEach(function (rawLabel) {
      var label = normalizeTrendingLabel(rawLabel);

      if (label && uniqueSearches.indexOf(label) === -1) {
        uniqueSearches.push(label);
      }
    });

    uniqueSearches.forEach(function (label) {
      var chip = document.createElement('button');

      chip.type = 'button';
      chip.className =
        'chip' +
        (label === normalizeTrendingLabel(state.activeDestination) ? ' active' : '');

      chip.textContent = label;

      chip.addEventListener('click', function () {
        handleTrendingClick(label);
      });

      container.appendChild(chip);
    });
  }

  function handleTrendingClick(rawLabel) {
    var label = normalizeTrendingLabel(rawLabel);

    // Update active chip without changing any other navigation behavior.
    $all('#trendingChips .chip').forEach(function (chip) {
      chip.classList.toggle(
        'active',
        normalizeTrendingLabel(chip.textContent) === label
      );
    });

    // ---------------------------------------------------------------
    // LUXURY RESORTS
    // Keep the existing featured-property behavior exactly as-is.
    // ---------------------------------------------------------------
    if (label === 'Luxury Resorts') {
      document.getElementById('destinationInput').value = label;
      document.getElementById('selectedPropertyId').value = '';
      document.getElementById('selectedDestination').value = '';

      var luxuryGrid = document.getElementById('resortGrid');

      luxuryGrid.innerHTML =
        '<div class="loading-state">' +
          '<span class="spinner"></span>' +
          '<p>Finding our premium resorts…</p>' +
        '</div>';

      callServer('getFeaturedProperties')
        .then(function (properties) {
          state.properties = properties || [];

          document.getElementById('resultsHeading').textContent =
            'Luxury Resorts';

          document.getElementById('resultsSubheading').textContent =
            'Our handpicked premium stays';

          renderResortGrid(state.properties);
        })
        .catch(function (err) {
          luxuryGrid.innerHTML =
            '<div class="empty-state">' +
              escapeHtml(err.message) +
            '</div>';
        });

      document.getElementById('hotels').scrollIntoView({
        behavior: 'smooth'
      });

      return;
    }

    // ---------------------------------------------------------------
    // DESTINATIONS
    // Sakleshpur / Kabini continue to use the existing destination filter.
    // ---------------------------------------------------------------
    if (KNOWN_DESTINATIONS.indexOf(label) !== -1) {
      selectDestination(label);
      return;
    }

    // ---------------------------------------------------------------
    // CURATED TRENDING CATEGORIES
    // ---------------------------------------------------------------
    if (TRENDING_CATEGORY_LABELS.indexOf(label) !== -1) {
      showTrendingCategory(label);
      return;
    }

    // ---------------------------------------------------------------
    // FALLBACK
    // Preserve keyword search for any future trending label.
    // ---------------------------------------------------------------
    document.getElementById('destinationInput').value = label;
    document.getElementById('selectedPropertyId').value = '';
    document.getElementById('selectedDestination').value = '';

    runSearch(
      { keyword: label },
      'Results for "' + label + '"'
    );
  }

  function showTrendingCategory(label) {
    var grid = document.getElementById('resortGrid');

    grid.innerHTML =
      '<div class="loading-state">' +
        '<span class="spinner"></span>' +
        '<p>Finding your perfect stay…</p>' +
      '</div>';

    document.getElementById('destinationInput').value = label;
    document.getElementById('selectedPropertyId').value = '';
    document.getElementById('selectedDestination').value = '';

    document.getElementById('hotels').scrollIntoView({
      behavior: 'smooth'
    });

    /*
     * Use the properties already loaded by getInitialHomeData().
     * If they are not available for some reason, load them once and then
     * apply the same local filter.
     */
    var propertiesPromise = state.allProperties && state.allProperties.length
      ? Promise.resolve(state.allProperties)
      : callServer('getInitialHomeData').then(function (data) {
          var properties = data && Array.isArray(data.properties)
            ? data.properties
            : [];

          state.allProperties = properties.slice();
          return properties;
        });

    propertiesPromise
      .then(function (properties) {
        var filtered = filterTrendingProperties(label, properties);

        state.properties = filtered;

        document.getElementById('resultsHeading').textContent = label;

        document.getElementById('resultsSubheading').textContent =
          filtered.length
            ? getTrendingSubheading(label)
            : 'No properties are currently available for this category.';

        renderResortGrid(filtered);
      })
      .catch(function (err) {
        grid.innerHTML =
          '<div class="empty-state">' +
            '<p>' +
              escapeHtml(
                err.message ||
                'Unable to load properties.'
              ) +
            '</p>' +
          '</div>';
      });
  }

  function filterTrendingProperties(label, properties) {
    var list = Array.isArray(properties) ? properties.slice() : [];

    return list.filter(function (p) {
      if (!p) return false;

      // Never show inactive properties in a public trending category.
      var status = String(p.status == null ? 'ACTIVE' : p.status)
        .trim()
        .toLowerCase();

      if (status && ['active', 'available', 'published', 'live'].indexOf(status) === -1) {
        return false;
      }

      var type = String(p.type || '').trim().toLowerCase();
      var destination = String(p.destination || '').trim().toLowerCase();

      var searchableText = [
        p.propertyName,
        p.description,
        p.shortDescription,
        p.highlights,
        p.amenities
      ].map(function (value) {
        if (Array.isArray(value)) return value.join(' ');
        return String(value == null ? '' : value);
      }).join(' ').toLowerCase();

      if (label === 'Couple Stay') {
        /*
         * Existing inventory has two room-style properties.
         * The text fallback also supports future properties explicitly
         * described as couple / romantic / honeymoon stays.
         */
        return (
          type === 'room' ||
          type === 'rooms' ||
          /\bcouples?\b|\bromantic\b|\bhoneymoon\b/.test(searchableText)
        );
      }

      if (label === 'Nature Resorts') {
        return type === 'resort' || type === 'resorts';
      }

      if (label === 'Weekend Gateways') {
        // Weekend Gateways should show all resort properties,
        // regardless of destination, but never room-type properties.
        return type === 'resort' || type === 'resorts';
      }

      return false;
    });
  }

  function getTrendingSubheading(label) {
    if (label === 'Couple Stay') {
      return 'Comfortable stays selected for couples.';
    }

    if (label === 'Nature Resorts') {
      return 'Resorts surrounded by nature and peaceful landscapes.';
    }

    if (label === 'Weekend Gateways') {
      return 'Quick escapes and relaxing stays in Kabini.';
    }

    return 'Explore our handpicked VINJAB stays.';
  }

  function selectDestination(destination) {
    state.activeDestination = destination;

    document.getElementById('destinationInput').value = destination;
    document.getElementById('selectedDestination').value = destination;
    document.getElementById('selectedPropertyId').value = '';

    $all('#trendingChips .chip').forEach(function (chip) {
      chip.classList.toggle(
        'active',
        chip.textContent === destination
      );
    });

    runSearch(
      { destination: destination },
      'Properties in ' + destination
    );
  }

  // ---------------------------------------------------------------
  // SEARCH (validate -> loading -> call backend -> render -> scroll)
  // ---------------------------------------------------------------
  function validateSearchInputs(checkIn, checkOut, rooms, adults, children) {
    if (!checkIn || new Date(checkIn) < new Date(todayStr())) return 'Check-in date cannot be before today.';
    if (!checkOut || new Date(checkOut) <= new Date(checkIn)) return 'Check-out date must be after check-in date.';
    if (rooms < 1) return 'Please select at least 1 room.';
    if (adults < 1) return 'Please select at least 1 adult.';
    if (children < 0) return 'Number of children cannot be negative.';
    return null;
  }

  document.getElementById('searchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var searchBtn = e.target.querySelector('button[type="submit"]');
    var checkIn = document.getElementById('checkInInput').value;
    var checkOut = document.getElementById('checkOutInput').value;
    var rooms = Number(document.getElementById('roomsInput').value) || 0;
    var adults = Number(document.getElementById('adultsInput').value) || 0;
    var children = Number(document.getElementById('childrenInput').value) || 0;

    var validationError = validateSearchInputs(checkIn, checkOut, rooms, adults, children);
    if (validationError) { showToast(validationError, true); return; }

    var propertyId = document.getElementById('selectedPropertyId').value;
    var typedText = document.getElementById('destinationInput').value.trim();
    var exactDestinationMatch = KNOWN_DESTINATIONS.find(function (d) { return d.toLowerCase() === typedText.toLowerCase(); });

    document.getElementById('hotels').scrollIntoView({ behavior: 'smooth' });
    setLoading(searchBtn, true, 'Finding your perfect stay…');

    var searchPromise;
    var heading;
    if (propertyId) {
      searchPromise = callServer('getPropertyById', propertyId).then(function (p) { return [p]; });
      heading = 'Search results';
    } else if (exactDestinationMatch) {
      state.activeDestination = exactDestinationMatch;
      searchPromise = callServer('getPropertiesByDestination', exactDestinationMatch);
      heading = 'Properties in ' + exactDestinationMatch;
    } else if (typedText) {
      searchPromise = callServer('searchProperties', typedText);
      heading = 'Search results for "' + typedText + '"';
    } else {
      searchPromise = callServer('getPropertiesByDestination', CONFIG_DEFAULT_DESTINATION());
      heading = 'Properties in ' + CONFIG_DEFAULT_DESTINATION();
    }

    searchPromise
      .then(function (properties) {
        setLoading(searchBtn, false);
        state.properties = properties || [];
        document.getElementById('resultsHeading').textContent = heading;
        document.getElementById('resultsSubheading').textContent =
          state.properties.length ? 'Stay dates: ' + checkIn + ' to ' + checkOut + ' · ' + rooms + ' room(s), ' + adults + ' adult(s), ' + children + ' child(ren)' : '';
        renderResortGrid(state.properties);
      })
      .catch(function (err) {
        setLoading(searchBtn, false);
        document.getElementById('resortGrid').innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + '</div>';
      });
  });

  function CONFIG_DEFAULT_DESTINATION() { return (state.config && state.config.defaultDestination) || 'Sakleshpur'; }

  function runSearch(filters, heading) {
    var grid = document.getElementById('resortGrid');
    grid.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Finding your perfect stay…</p></div>';
    var promise = filters.destination
      ? callServer('getPropertiesByDestination', filters.destination)
      : callServer('searchProperties', filters.keyword);

    promise.then(function (properties) {
      state.properties = properties || [];
      if (heading) document.getElementById('resultsHeading').textContent = heading;
      renderResortGrid(state.properties);
    }).catch(function (err) {
      grid.innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + '</div>';
    });
  }

  // ---------------------------------------------------------------
  // RESULTS RENDERING
  // ---------------------------------------------------------------
function priceBlockHtml(p) {

  if (p.pricePerNight) {

    return '<div class="price">' +
      '<strong>' + formatInr(p.pricePerNight) + '</strong>' +
      '<span>/ couple</span>' +
    '</div>';

  }

  return '<div class="price no-price">' +
    '<strong>Contact for Price</strong>' +
  '</div>';
}

  function renderResortGrid(properties) {
    var grid = document.getElementById('resortGrid');
    if (!properties || !properties.length) {
      grid.innerHTML =
        '<div class="empty-state">' +
          '<p>No resorts found for your search.</p>' +
          '<button class="btn btn-outline" id="tryAnotherDestinationBtn">Try another destination</button>' +
        '</div>';
      var btn = document.getElementById('tryAnotherDestinationBtn');
      if (btn) btn.addEventListener('click', function () { selectDestination(CONFIG_DEFAULT_DESTINATION()); });
      return;
    }

    grid.innerHTML = properties.map(function (p) {
      var img = p.imageUrl
        ? 'background-image:url(\'' + p.imageUrl + '\')'
        : 'background:linear-gradient(135deg,#1a3c34,#01261f);';
      var ratingHtml = p.rating ? '<span class="rating">★ ' + p.rating.toFixed(1) + '</span>' : '';
      var amenitiesHtml = (p.amenities || []).slice(0, 4).map(function (a) { return '<span>' + escapeHtml(a) + '</span>'; }).join('');

      return (
        '<div class="resort-card">' +
          '<div class="thumb" style="' + img + '">' +
            '<span class="badge">' + escapeHtml(p.destination) + ' · ' + escapeHtml(p.type) + '</span>' +
            '<span class="availability-badge">Available on Request</span>' +
          '</div>' +
          '<div class="body">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
              '<h3>' + escapeHtml(p.propertyName) + '</h3>' + ratingHtml +
            '</div>' +
            '<div class="location">📍 ' + escapeHtml(p.destination) + '</div>' +
            (p.shortDescription ? '<p style="font-size:14px;color:var(--color-text-soft);">' + escapeHtml(p.shortDescription) + '</p>' : '') +
            (amenitiesHtml ? '<div class="amenities">' + amenitiesHtml + '</div>' : '') +
            priceBlockHtml(p) +
          '</div>' +
          '<div class="actions">' +
            '<button class="btn btn-outline" data-view-property="' + escapeHtml(p.propertyId) + '">View Details</button>' +
            '<button class="btn btn-primary" data-book-property="' + escapeHtml(p.propertyId) + '">Book Now</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    $all('[data-view-property]', grid).forEach(function (b) { b.addEventListener('click', function () { openPropertyDetails(b.getAttribute('data-view-property')); }); });
    $all('[data-book-property]', grid).forEach(function (b) {
      b.addEventListener('click', function () {
        var property = state.properties.find(function (p) { return p.propertyId === b.getAttribute('data-book-property'); });
        startBookingFlow(property);
      });
    });
  }

  // ---------------------------------------------------------------
  // PROPERTY DETAILS MODAL
  // ---------------------------------------------------------------
  function openPropertyDetails(propertyId) {
    var overlay = document.getElementById('resortModalOverlay');
    var modal = document.getElementById('resortModal');
    modal.innerHTML = '<button class="modal-close" id="closeResortModal">✕</button><p>Loading…</p>';
    overlay.classList.remove('hidden');
    $('#closeResortModal', modal).addEventListener('click', closeResortModal);

    callServer('getPropertyById', propertyId).then(function (p) {
      var img = p.imageUrl ? '<div style="height:220px;border-radius:8px;background:url(\'' + p.imageUrl + '\') center/cover no-repeat;margin-bottom:16px;"></div>' : '';
      var highlights = (p.highlights || []).map(function (h) { return '<li>' + escapeHtml(h) + '</li>'; }).join('');
      var amenities = (p.amenities || []).map(function (a) { return '<li>' + escapeHtml(a) + '</li>'; }).join('');

      modal.innerHTML =
        '<button class="modal-close" id="closeResortModal">✕</button>' +
        img +
        '<h2>' + escapeHtml(p.propertyName) + '</h2>' +
        '<p class="form-help">📍 ' + escapeHtml(p.destination) + (p.rating ? ' · ★ ' + p.rating.toFixed(1) : '') + ' · ' + escapeHtml(p.type) + '</p>' +
        '<p style="margin-top:12px;">' + escapeHtml(p.description) + '</p>' +
        (highlights ? '<h4 style="margin-top:20px;font-size:16px;">Highlights</h4><ul>' + highlights + '</ul>' : '') +
        (amenities ? '<h4 style="margin-top:16px;font-size:16px;">Amenities</h4><ul>' + amenities + '</ul>' : '') +
        priceBlockHtml(p) +
        '<button class="btn btn-primary btn-block btn-lg" style="margin-top:16px;" id="detailsBookNow">Book Now</button>';

      $('#closeResortModal', modal).addEventListener('click', closeResortModal);
      $('#detailsBookNow', modal).addEventListener('click', function () { closeResortModal(); startBookingFlow(p); });
    }).catch(function (err) {
      modal.innerHTML = '<button class="modal-close" id="closeResortModal">✕</button><p>' + escapeHtml(err.message) + '</p>';
      $('#closeResortModal', modal).addEventListener('click', closeResortModal);
    });
  }
  function closeResortModal() { document.getElementById('resortModalOverlay').classList.add('hidden'); }
  document.getElementById('resortModalOverlay').addEventListener('click', function (e) { if (e.target === this) closeResortModal(); });

  // ---------------------------------------------------------------
  // BOOKING FLOW (Dates/Guests -> Guest Details -> OTP -> Success)
  // ---------------------------------------------------------------
  function startBookingFlow(property) {
    if (!property) { showToast('Please select a property first.', true); return; }
    state.booking = {
      property: property,
      checkIn: document.getElementById('checkInInput').value || todayStr(),
      checkOut: document.getElementById('checkOutInput').value || addDays(todayStr(), 1),
      rooms: Number(document.getElementById('roomsInput').value) || 1,
      adults: Number(document.getElementById('adultsInput').value) || 2,
      children: Number(document.getElementById('childrenInput').value) || 0,
      phoneVerified: false
    };
    state.bookingSessionId = newSessionId();
    state.bookingRequestId = newRequestId();
    renderBookingStepDates();
    document.getElementById('bookingModalOverlay').classList.remove('hidden');
  }
  function closeBookingModal() { document.getElementById('bookingModalOverlay').classList.add('hidden'); }
  document.getElementById('bookingModalOverlay').addEventListener('click', function (e) { if (e.target === this) closeBookingModal(); });

  function stepIndicator(activeIndex) {
    var steps = ['Dates & Guests', 'Guest Details', 'Verify OTP'];
    return '<div class="step-indicator">' + steps.map(function (_, i) {
      var cls = i < activeIndex ? 'done' : (i === activeIndex ? 'active' : '');
      return '<div class="dot ' + cls + '"></div>';
    }).join('') + '</div>';
  }

  function renderBookingStepDates() {
    var modal = document.getElementById('bookingModal');
    var b = state.booking;
    modal.innerHTML =
      '<button class="modal-close" id="closeBookingModal">✕</button>' +
      stepIndicator(0) +
      '<h2>' + escapeHtml(b.property.propertyName) + '</h2>' +
      '<p class="form-help">' + escapeHtml(b.property.destination) + ' · ' + escapeHtml(b.property.type) + '</p>' +
      '<div class="form-grid" style="margin-top:20px;">' +
        '<div class="form-group"><label>Check In</label><input type="date" id="bCheckIn" value="' + b.checkIn + '" min="' + todayStr() + '"></div>' +
        '<div class="form-group"><label>Check Out</label><input type="date" id="bCheckOut" value="' + b.checkOut + '"></div>' +
        '<div class="form-group"><label>Rooms</label><input type="number" id="bRooms" min="1" value="' + b.rooms + '"></div>' +
        '<div class="form-group"><label>Adults</label><input type="number" id="bAdults" min="1" value="' + b.adults + '"></div>' +
        '<div class="form-group full"><label>Children</label><input type="number" id="bChildren" min="0" value="' + b.children + '"></div>' +
        '<div class="form-group full"><label>Special Request (optional)</label><textarea id="bSpecialRequest" placeholder="e.g. early check-in, dietary needs"></textarea></div>' +
      '</div>' +
      '<div class="form-error" id="datesError"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" style="margin-top:16px;" id="continueToGuestDetails">Continue</button>';

    $('#closeBookingModal', modal).addEventListener('click', closeBookingModal);
    $('#continueToGuestDetails', modal).addEventListener('click', function () {
      var checkIn = $('#bCheckIn', modal).value;
      var checkOut = $('#bCheckOut', modal).value;
      var rooms = Number($('#bRooms', modal).value) || 0;
      var adults = Number($('#bAdults', modal).value) || 0;
      var children = Number($('#bChildren', modal).value) || 0;
      var errorEl = $('#datesError', modal);

      var validationError = validateSearchInputs(checkIn, checkOut, rooms, adults, children);
      if (validationError) { errorEl.textContent = validationError; return; }

      state.booking.checkIn = checkIn; state.booking.checkOut = checkOut;
      state.booking.rooms = rooms; state.booking.adults = adults; state.booking.children = children;
      state.booking.specialRequest = $('#bSpecialRequest', modal).value.trim();
      renderBookingStepGuestDetails();
    });
  }

  function renderBookingStepGuestDetails() {
    var modal = document.getElementById('bookingModal');
    modal.innerHTML =
      '<button class="modal-close" id="closeBookingModal">✕</button>' +
      stepIndicator(1) +
      '<h2>Guest Details</h2>' +
      '<p class="form-help">We\'ll use these details to confirm your booking.</p>' +
      '<div class="form-grid" style="margin-top:20px;">' +
        '<div class="form-group full"><label>Full Name *</label><input type="text" id="gName"></div>' +
        '<div class="form-group full"><label>Email ID *</label><input type="email" id="gEmail"></div>' +
        '<div class="form-group full"><label>Phone Number *</label>' +
          '<div style="display:flex;gap:8px;"><span style="padding:12px 0;font-weight:600;color:var(--color-text-soft);">+91</span><input type="tel" id="gPhone" maxlength="10" placeholder="10-digit mobile number" style="flex:1;"></div>' +
        '</div>' +
      '</div>' +
      '<div class="consent-row booking-privacy-consent" style="margin-top:16px;">' +
        '<input type="checkbox" id="bookingPrivacyConsent" name="bookingPrivacyConsent">' +
        '<label for="bookingPrivacyConsent">I agree to the <a href="#privacy-policy" class="privacy-link js-open-privacy">Privacy Policy</a> and consent to VINJAB Group of Companies using my details to process this booking enquiry.</label>' +
      '</div>' +
      '<div class="form-error" id="guestError"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" style="margin-top:16px;" id="sendOtpBtn">Send OTP</button>';

    $('#closeBookingModal', modal).addEventListener('click', closeBookingModal);
    $('#sendOtpBtn', modal).addEventListener('click', function () {
      var name = $('#gName', modal).value.trim();
      var email = $('#gEmail', modal).value.trim();
      var phone = $('#gPhone', modal).value.trim();
      var errorEl = $('#guestError', modal);

      if (!name) { errorEl.textContent = 'Please enter your full name.'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errorEl.textContent = 'Please enter a valid email address.'; return; }
      if (!/^[6-9]\d{9}$/.test(phone)) { errorEl.textContent = 'Please enter a valid 10-digit Indian mobile number.'; return; }
      if (!document.getElementById('bookingPrivacyConsent').checked) {
        errorEl.textContent = 'Please agree to the Privacy Policy before continuing.';
        return;
      }

      state.booking.customerName = name; state.booking.email = email; state.booking.phone = phone;

      var btn = $('#sendOtpBtn', modal);
      setLoading(btn, true, 'Sending OTP…');
      errorEl.textContent = '';
      callServer('sendOtp', phone, state.bookingSessionId)
        .then(function (result) { renderBookingStepOtp(result); })
        .catch(function (err) { setLoading(btn, false); errorEl.textContent = err.message; });
    });
  }

  function renderBookingStepOtp(sendResult) {
    var modal = document.getElementById('bookingModal');
    var b = state.booking;
    var cooldown = (state.config.otp && state.config.otp.resendCooldownSeconds) || 60;
    var devHint = sendResult && sendResult.devOtp
      ? '<p class="form-help" style="color:var(--success);">Development mode: your test OTP is <strong>' + sendResult.devOtp + '</strong> (configure an SMS provider before going live).</p>'
      : '';

    modal.innerHTML =
      '<button class="modal-close" id="closeBookingModal">✕</button>' +
      stepIndicator(2) +
      '<h2>Verify Your Mobile Number</h2>' +
      '<p class="form-help">We sent a 6-digit code to +91 ' + escapeHtml(b.phone) + '.</p>' +
      devHint +
      '<div class="form-group" style="margin-top:16px;"><label>Enter OTP</label><input type="text" id="otpInput" maxlength="6" inputmode="numeric" placeholder="6-digit code"></div>' +
      '<div class="form-error" id="otpError"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" style="margin-top:8px;" id="verifyOtpBtn">Verify OTP</button>' +
      '<button class="btn-link" style="margin-top:16px;" id="resendOtpBtn" disabled>Resend OTP (<span id="resendTimer">' + cooldown + '</span>s)</button>';

    $('#closeBookingModal', modal).addEventListener('click', closeBookingModal);

    var timeLeft = cooldown;
    var timer = setInterval(function () {
      timeLeft--;
      var timerEl = $('#resendTimer', modal);
      if (!timerEl) { clearInterval(timer); return; }
      timerEl.textContent = timeLeft;
      if (timeLeft <= 0) {
        clearInterval(timer);
        var resendBtn = $('#resendOtpBtn', modal);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend OTP';
      }
    }, 1000);

    $('#resendOtpBtn', modal).addEventListener('click', function () {
      var btn = this;
      setLoading(btn, true, 'Resending…');
      callServer('sendOtp', b.phone, state.bookingSessionId)
        .then(function (result) { renderBookingStepOtp(result); })
        .catch(function (err) { setLoading(btn, false); showToast(err.message, true); });
    });

    $('#verifyOtpBtn', modal).addEventListener('click', function () {
      var code = $('#otpInput', modal).value.trim();
      var errorEl = $('#otpError', modal);
      if (!/^\d{4,6}$/.test(code)) { errorEl.textContent = 'Please enter the OTP you received.'; return; }

      var btn = $('#verifyOtpBtn', modal);
      setLoading(btn, true, 'Verifying…');
      errorEl.textContent = '';
      callServer('verifyOtp', b.phone, code, state.bookingSessionId)
        .then(function () { b.phoneVerified = true; submitFinalBooking(); })
        .catch(function (err) { setLoading(btn, false); errorEl.textContent = err.message; });
    });
  }

  function submitFinalBooking() {
    var modal = document.getElementById('bookingModal');
    modal.innerHTML = '<div style="text-align:center;padding:48px 0;"><span class="spinner" style="width:32px;height:32px;border-color:rgba(1,38,31,0.2);border-top-color:var(--color-primary);"></span><p style="margin-top:16px;">Confirming your booking request…</p></div>';

    var b = state.booking;
    var payload = {
      customerName: b.customerName, email: b.email, phone: b.phone,
      bookingSessionId: state.bookingSessionId, requestId: state.bookingRequestId,
      propertyId: b.property.propertyId,
      checkIn: b.checkIn, checkOut: b.checkOut,
      rooms: b.rooms, adults: b.adults, children: b.children,
      specialRequest: b.specialRequest || '',
      source: state.source, campaign: state.campaign
    };

    callServer('submitBooking', payload)
      .then(function (result) { renderBookingSuccess(result); })
      .catch(function (err) {
        modal.innerHTML =
          '<button class="modal-close" id="closeBookingModal">✕</button>' +
          '<div style="text-align:center;padding:24px 0;"><h2>Something Went Wrong</h2><p class="form-help" style="margin-top:12px;">' + escapeHtml(err.message) + '</p>' +
          '<button class="btn btn-primary" style="margin-top:20px;" id="retryBookingBtn">Try Again</button></div>';
        $('#closeBookingModal', modal).addEventListener('click', closeBookingModal);
        $('#retryBookingBtn', modal).addEventListener('click', renderBookingStepDates);
      });
  }

  function renderBookingSuccess(result) {
    var modal = document.getElementById('bookingModal');
    var priceRow = result.hasConfiguredPrice
      ? '<div class="row"><span>Estimated Total</span><span>' + formatInr(result.totalAmount) + '</span></div>'
      : '<div class="row"><span>Pricing</span><span>Contact for Price</span></div>';

    modal.innerHTML =
      '<button class="modal-close" id="closeBookingModal">✕</button>' +
      '<div class="success-screen">' +
        '<div class="success-emoji">🎉</div>' +
        '<h2>Thank You!</h2>' +
        '<p class="lead">Your booking request has been received successfully. Our team will contact you shortly. 😊</p>' +
        '<p class="lead">We look forward to welcoming you to VINJAB Resorts! 🌿✨</p>' +
        '<div class="summary-box">' +
          '<div class="row"><span>Booking Request ID</span><span>' + escapeHtml(result.bookingId) + '</span></div>' +
          '<div class="row"><span>Property</span><span>' + escapeHtml(result.propertyName) + '</span></div>' +
          '<div class="row"><span>Location</span><span>' + escapeHtml(result.destination) + '</span></div>' +
          '<div class="row"><span>Check-in</span><span>' + escapeHtml(result.checkIn) + '</span></div>' +
          '<div class="row"><span>Check-out</span><span>' + escapeHtml(result.checkOut) + '</span></div>' +
          '<div class="row"><span>Guests</span><span>' + result.adults + ' adult(s), ' + result.children + ' child(ren)</span></div>' +
          priceRow +
        '</div>' +
        '<button class="btn btn-primary btn-block btn-lg" style="margin-top:24px;" id="backToResortsBtn">Back to Resorts</button>' +
      '</div>';

    $('#closeBookingModal', modal).addEventListener('click', closeBookingModal);
    $('#backToResortsBtn', modal).addEventListener('click', function () {
      closeBookingModal();
      document.getElementById('hotels').scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ---------------------------------------------------------------
  // PLACEMENT / BPO / CONTACT FORMS
  // ---------------------------------------------------------------
  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function initPlacementForm() {
    var form = document.getElementById('placementForm');
    form.dataset.requestId = newRequestId();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var errorEl = document.getElementById('placementError');
      errorEl.textContent = '';
      var fd = new FormData(form);
      var submitBtn = form.querySelector('button[type="submit"]');
      var fileInput = form.querySelector('input[name="resume"]');
      var file = fileInput.files[0];

      var basePayload = {
        fullName: fd.get('fullName'), email: fd.get('email'), phone: fd.get('phone'),
        currentLocation: fd.get('currentLocation'), qualification: fd.get('qualification'),
        experience: fd.get('experience'), skills: fd.get('skills'),
        preferredRole: fd.get('preferredRole'), preferredLocation: fd.get('preferredLocation'),
        source: state.source, campaign: state.campaign, requestId: form.dataset.requestId
      };

      setLoading(submitBtn, true, 'Submitting…');
      var withResume = file
        ? readFileAsBase64(file).then(function (base64) {
            basePayload.resumeBase64 = base64; basePayload.resumeFileName = file.name; basePayload.resumeMimeType = file.type;
          })
        : Promise.resolve();

      withResume
        .then(function () { return callServer('submitPlacementLead', basePayload); })
        .then(function () {
          setLoading(submitBtn, false);
          form.reset();
          form.dataset.requestId = newRequestId();
          showToast('Application received! Our placement team will reach out soon.');
        })
        .catch(function (err) { setLoading(submitBtn, false); errorEl.textContent = err.message; });
    });
  }

  function initBpoForm() {
    var form = document.getElementById('bpoForm');
    form.dataset.requestId = newRequestId();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var errorEl = document.getElementById('bpoError');
      errorEl.textContent = '';
      var fd = new FormData(form);
      var submitBtn = form.querySelector('button[type="submit"]');

      var payload = {
        companyName: fd.get('companyName'), contactPerson: fd.get('contactPerson'),
        businessEmail: fd.get('businessEmail'), phone: fd.get('phone'),
        industry: fd.get('industry'), requiredService: fd.get('requiredService'),
        teamSize: fd.get('teamSize'), message: fd.get('message'),
        source: state.source, campaign: state.campaign, requestId: form.dataset.requestId
      };

      setLoading(submitBtn, true, 'Submitting…');
      callServer('submitBpoLead', payload)
        .then(function () {
          setLoading(submitBtn, false);
          form.reset();
          form.dataset.requestId = newRequestId();
          showToast('Enquiry received! Our BPO specialists will design a custom solution for you.');
        })
        .catch(function (err) { setLoading(submitBtn, false); errorEl.textContent = err.message; });
    });
  }

  function initContactForm() {
    var form = document.getElementById('contactForm');
    form.dataset.requestId = newRequestId();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var errorEl = document.getElementById('contactError');
      errorEl.textContent = '';
      var fd = new FormData(form);
      var submitBtn = form.querySelector('button[type="submit"]');

      var payload = {
        name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'),
        subject: fd.get('subject'), message: fd.get('message'), requestId: form.dataset.requestId
      };

      setLoading(submitBtn, true, 'Sending…');
      callServer('submitContactMessage', payload)
        .then(function () {
          setLoading(submitBtn, false);
          form.reset();
          form.dataset.requestId = newRequestId();
          showToast('Message sent! We\'ll get back to you shortly.');
        })
        .catch(function (err) { setLoading(submitBtn, false); errorEl.textContent = err.message; });
    });
  }

  // ---------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------
  function initDates() {
    document.getElementById('checkInInput').min = todayStr();
    document.getElementById('checkInInput').value = todayStr();
    document.getElementById('checkOutInput').min = addDays(todayStr(), 1);
    document.getElementById('checkOutInput').value = addDays(todayStr(), 1);
    document.getElementById('checkInInput').addEventListener('change', function () {
      document.getElementById('checkOutInput').min = addDays(this.value, 1);
      if (new Date(document.getElementById('checkOutInput').value) <= new Date(this.value)) {
        document.getElementById('checkOutInput').value = addDays(this.value, 1);
      }
    });
  }

  function init() {
    initPrivacyPolicyModal();
    initNav();
    initDates();
    initAutocomplete();
    initPlacementForm();
    initBpoForm();
    initContactForm();

    callServer('getInitialHomeData')
      .then(function (data) {
        state.config = data.config;
        state.allProperties = Array.isArray(data.properties) ? data.properties.slice() : [];
        state.properties = state.allProperties.slice();
        state.activeDestination = data.defaultDestination;

        initTrendingChips();
        renderResortGrid(state.properties);

        var whatsappFab = document.getElementById('whatsappFab');
        if (state.config.whatsappNumber) {
          whatsappFab.href = 'https://wa.me/' + state.config.whatsappNumber.replace(/\D/g, '');
        } else {
          whatsappFab.classList.add('hidden');
        }
      })
      .catch(function (err) {
        document.getElementById('resortGrid').innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + '</div>';
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
