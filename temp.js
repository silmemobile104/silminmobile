
        // Check Auth
        const token = localStorage.getItem('token');
        const userString = localStorage.getItem('user');
        if (!token || !userString) {
            window.location.href = '/';
        }

        // Authorization check
        const currentUser = JSON.parse(userString);
        const userDept = currentUser.department || '';
        const isStockTeam = userDept.includes('Store') || userDept.includes('Stock') || userDept.includes('สต๊อก');
        if (!isStockTeam && !['admin', 'executive', 'manager'].includes(currentUser.role)) {
            alert('สิทธิ์การเข้าถึงถูกปฏิเสธ: เฉพาะพนักงานฝ่ายสต็อกเท่านั้น');
            window.location.href = '/dashboard';
        }

        // Filter UI Handling
        function handleReportTypeChange() {
            const type = document.getElementById('report-type').value;
            const container = document.getElementById('filter-input-container');
            container.innerHTML = '';

            const today = new Date();

            if (type === 'monthly') {
                const monthInput = document.createElement('input');
                monthInput.type = 'month';
                monthInput.id = 'filter-month';
                monthInput.className = 'w-full px-4 py-2 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-yellow-500';
                monthInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

                const wrapper = document.createElement('div');
                wrapper.className = 'w-full';
                wrapper.innerHTML = '<label class="block text-sm font-bold text-slate-700 mb-2">เลือกเดือน</label>';
                wrapper.appendChild(monthInput);
                container.appendChild(wrapper);
            }
            else if (type === 'yearly') {
                const yearInput = document.createElement('input');
                yearInput.type = 'number';
                yearInput.id = 'filter-year';
                yearInput.min = '2000';
                yearInput.max = '2100';
                yearInput.className = 'w-full px-4 py-2 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-yellow-500';
                yearInput.value = today.getFullYear();

                const wrapper = document.createElement('div');
                wrapper.className = 'w-full';
                wrapper.innerHTML = '<label class="block text-sm font-bold text-slate-700 mb-2">ระบุปี (ค.ศ.)</label>';
                wrapper.appendChild(yearInput);
                container.appendChild(wrapper);
            }
            else if (type === 'custom') {
                container.innerHTML = `
                    <div class="w-1/2">
                        <label class="block text-sm font-bold text-slate-700 mb-2">วันเริ่มต้น</label>
                        <input type="date" id="filter-start" class="w-full px-4 py-2 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-yellow-500">
                    </div>
                    <div class="w-1/2">
                        <label class="block text-sm font-bold text-slate-700 mb-2">วันสิ้นสุด</label>
                        <input type="date" id="filter-end" class="w-full px-4 py-2 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-yellow-500">
                    </div>
                `;
                // Set default to today
                const d = today.toISOString().split('T')[0];
                document.getElementById('filter-start').value = d;
                document.getElementById('filter-end').value = d;
            }
            // type === 'today' needs no additional inputs
        }

        // ------------------------------------
        // Dashboard Core JS
        // ------------------------------------
        let allStockData = [];
        let currentTab = 'all';

        // Toggle Sidebar for Mobile
        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            if (sidebar.classList.contains('-translate-x-full')) {
                sidebar.classList.remove('-translate-x-full');
                overlay.classList.remove('hidden');
            } else {
                sidebar.classList.add('-translate-x-full');
                overlay.classList.add('hidden');
            }
        }

        async function updateDashboard() {
            const type = document.getElementById('report-type').value;
            let startDate, endDate;
            const today = new Date();

            if (type === 'today') {
                startDate = new Date(today.setHours(0, 0, 0, 0)).toISOString();
                endDate = new Date(today.setHours(23, 59, 59, 999)).toISOString();
            } else if (type === 'monthly') {
                const monthVal = document.getElementById('filter-month').value; // YYYY-MM
                if (!monthVal) return Swal.fire('แจ้งเตือน', 'กรุณาเลือกเดือน', 'warning');
                const [y, m] = monthVal.split('-');
                startDate = new Date(parseInt(y), parseInt(m) - 1, 1, 0, 0, 0, 0).toISOString();
                endDate = new Date(parseInt(y), parseInt(m), 0, 23, 59, 59, 999).toISOString();
            } else if (type === 'yearly') {
                const yearVal = document.getElementById('filter-year').value;
                if (!yearVal) return Swal.fire('แจ้งเตือน', 'กรุณาระบุปี', 'warning');
                startDate = new Date(parseInt(yearVal), 0, 1, 0, 0, 0, 0).toISOString();
                endDate = new Date(parseInt(yearVal), 11, 31, 23, 59, 59, 999).toISOString();
            } else if (type === 'custom') {
                const startVal = document.getElementById('filter-start').value;
                const endVal = document.getElementById('filter-end').value;
                if (!startVal || !endVal) return Swal.fire('แจ้งเตือน', 'กรุณาเลือกช่วงวันให้ครบถ้วน', 'warning');

                startDate = new Date(startVal + 'T00:00:00').toISOString();
                endDate = new Date(endVal + 'T23:59:59.999').toISOString();
            }

            try {
                // Show loading
                document.getElementById('stock-table-body').innerHTML = `<tr><td colspan="7" class="px-6 py-12 text-center text-slate-400"><div class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-yellow-500 rounded-full mb-2"></div><br>กำลังโหลดข้อมูล...</td></tr>`;

                const response = await fetch(`/api/daily-stocks/report?startDate=${startDate}&endDate=${endDate}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const data = await response.json();
                    allStockData = data.data;

                    // Extract and populate branches
                    const branches = [...new Set(allStockData.map(i => i.branch))].filter(Boolean).sort();
                    const branchSelect = document.getElementById('branch-filter');
                    if (branchSelect) {
                        const currentVal = branchSelect.value;
                        let options = '<option value="all">ทั้งหมด (ทุกสาขา)</option>';
                        branches.forEach(b => {
                            options += `<option value="${b}">${b}</option>`;
                        });
                        branchSelect.innerHTML = options;

                        // Preserve selected choice if it exists
                        if (branches.includes(currentVal)) {
                            branchSelect.value = currentVal;
                        } else {
                            branchSelect.value = 'all';
                        }
                    }

                    updateCards();
                    renderTable();
                } else {
                    console.error('Failed to fetch report');
                    document.getElementById('stock-table-body').innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-red-500">เรียกข้อมูลล้มเหลว</td></tr>`;
                }
            } catch (e) {
                console.error('Error fetching report:', e);
            }
        }

        function getFilteredData() {
            let filtered = allStockData;

            // 1. Branch Filter
            const branchSelect = document.getElementById('branch-filter');
            if (branchSelect && branchSelect.value !== 'all') {
                filtered = filtered.filter(i => i.branch === branchSelect.value);
            }

            // 2. Type Filter (iPhone หรือ iPad)
            const filterType = document.getElementById('filterType').value;
            if (filterType === 'iPad') {
                filtered = filtered.filter(i => (i.productName || '').toLowerCase().includes('ipad'));
            } else if (filterType === 'iPhone') {
                filtered = filtered.filter(i => !(i.productName || '').toLowerCase().includes('ipad'));
            }

            // 3. Model Filter (กรอกชื่อรุ่น)
            const filterModelValue = document.getElementById('filterModel').value.toLowerCase().trim();
            if (filterModelValue) {
                filtered = filtered.filter(i => (i.productName || '').toLowerCase().includes(filterModelValue));
            }

            return filtered;
        }

        function applyFilters() {
            updateCards();
            renderTable();
        }

        function updateCards() {
            const data = getFilteredData();
            const total = data.length;
            const pending = data.filter(i => i.status === 'pending').length;
            const waiting = data.filter(i => i.status === 'checked' && i.verificationStatus === 'waiting').length;
            const success = data.filter(i => i.status === 'checked' && i.verificationStatus === 'success').length;
            const notChecked = data.filter(i => i.status === 'not_checked').length;
            const failed = data.filter(i => i.status !== 'not_checked' && i.verificationStatus === 'failed').length;

            document.getElementById('sum-total').textContent = total;
            document.getElementById('sum-pending').textContent = pending;
            document.getElementById('sum-waiting').textContent = waiting;
            document.getElementById('sum-success').textContent = success;
            document.getElementById('sum-not-checked').textContent = notChecked;
            document.getElementById('sum-failed').textContent = failed;
        }

        function showFailedBreakdown() {
            const data = getFilteredData();
            const failedItems = data.filter(i => i.status === 'not_checked' || i.verificationStatus === 'failed');
            if (failedItems.length === 0) {
                Swal.fire('ข้อมูล', 'ไม่มีรายการที่ไม่สำเร็จ', 'info');
                return;
            }

            const breakdown = {
                'not_checked': 0, 'in_transit': 0, 'imei_mismatch': 0,
                'repair': 0, 'claim': 0, 'backup': 0, 'other': 0
            };

            failedItems.forEach(item => {
                let reason = item.failReason;
                if (!reason) reason = 'not_checked';
                if (!breakdown.hasOwnProperty(reason)) {
                    breakdown.other++;
                } else {
                    breakdown[reason]++;
                }
            });

            let htmlList = '<ul class="text-left mt-4 text-slate-600 bg-slate-50 p-4 rounded-lg space-y-2">';
            const orderedKeys = Object.keys(reasonMap);
            orderedKeys.forEach(k => {
                if (breakdown[k] > 0) {
                    htmlList += `<li class="flex justify-between items-center border-b border-slate-200 pb-2 last:border-b-0 last:pb-0">
                        <span class="font-medium flex items-center gap-2"><ion-icon name="caret-forward-outline" class="text-red-400"></ion-icon> ${reasonMap[k]}</span>
                        <span class="bg-red-100 text-red-600 px-3 py-1 rounded-full text-xs font-bold">${breakdown[k]} รายการ</span>
                    </li>`;
                }
            });
            htmlList += '</ul>';

            Swal.fire({
                title: 'รายละเอียดไม่สำเร็จ',
                html: htmlList,
                confirmButtonText: 'ปิด',
                confirmButtonColor: '#eab308'
            });
        }

        function setTab(tab) {
            currentTab = tab;
            const tabs = ['all', 'pending', 'waiting', 'success', 'failed', 'not_checked'];

            tabs.forEach(t => {
                const tr = document.getElementById(`tab-${t}`);
                if (!tr) return;

                if (t === tab) {
                    tr.classList.remove('border-transparent', 'text-slate-500', 'hover:text-slate-700');
                    tr.classList.add('border-yellow-500', 'text-yellow-600');
                } else {
                    tr.classList.remove('border-yellow-500', 'text-yellow-600');
                    tr.classList.add('border-transparent', 'text-slate-500', 'hover:text-slate-700');
                }
            });
            renderTable();
        }

        const reasonMap = {
            'not_checked': 'ไม่ตรวจสอบ',
            'in_transit': 'เครื่องกำลังจัดส่ง',
            'imei_mismatch': 'อีมี่ไม่ตรง',
            'repair': 'ส่งซ่อม',
            'claim': 'ส่งเคลม',
            'backup': 'สำรองลูกค้า',
            'other': 'อื่นๆ'
        };

        function renderTable() {
            const tbody = document.getElementById('stock-table-body');
            tbody.innerHTML = '';

            let filtered = getFilteredData();
            if (currentTab === 'pending') filtered = filtered.filter(i => i.status === 'pending');
            if (currentTab === 'waiting') filtered = filtered.filter(i => i.status === 'checked' && i.verificationStatus === 'waiting');
            if (currentTab === 'success') filtered = filtered.filter(i => i.status === 'checked' && i.verificationStatus === 'success');
            if (currentTab === 'failed') filtered = filtered.filter(i => i.status !== 'not_checked' && i.verificationStatus === 'failed');
            if (currentTab === 'not_checked') filtered = filtered.filter(i => i.status === 'not_checked');

            if (filtered.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-12 text-center text-slate-400">ไม่พบรายการสินค้าในหมวดหมู่นี้</td></tr>`;
                return;
            }

            filtered.forEach((item, index) => {
                let statusBadge = '';

                if (item.status === 'pending') {
                    statusBadge = `<span class="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1"><ion-icon name="time"></ion-icon> รอฝ่ายขายตรวจ</span>`;
                } else if (item.status === 'not_checked') {
                    statusBadge = `<div class="flex flex-col gap-1 items-start">
                        <span class="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1"><ion-icon name="close-circle"></ion-icon> ฝ่ายขายไม่ได้ตรวจสอบ</span>
                    </div>`;
                } else {
                    // status === 'checked'
                    if (item.verificationStatus === 'waiting') {
                        statusBadge = `<span class="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1"><ion-icon name="hourglass-outline"></ion-icon> รอสต็อกยืนยัน</span>`;
                    } else if (item.verificationStatus === 'success') {
                        statusBadge = `<span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1"><ion-icon name="checkmark-done-circle"></ion-icon> ตรวจสมบูรณ์</span>`;
                    } else if (item.verificationStatus === 'failed') {
                        const reasonText = reasonMap[item.failReason] || item.failReason;
                        statusBadge = `<div class="flex flex-col gap-1 items-start">
                            <span class="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1"><ion-icon name="alert-circle"></ion-icon> ${reasonText}</span>
                            ${item.failDetail ? `<span class="text-xs text-red-400 font-medium ml-1" title="${item.failDetail}">* ${item.failDetail.substring(0, 15)}${item.failDetail.length > 15 ? '...' : ''}</span>` : ''}
                        </div>`;
                    }
                }

                let checkerInfo = '<span class="text-slate-300">-</span>';
                let evidenceBtn = '<span class="text-slate-300">-</span>';

                if (item.status === 'checked') {
                    if (item.checkedBy) {
                        const time = new Date(item.scannedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                        checkerInfo = `<div class="text-xs">
                            <div class="font-bold text-slate-700"><ion-icon name="person-circle-outline" class="align-middle"></ion-icon> ${item.checkedBy.fullname || item.checkedBy.username}</div>
                            <div class="text-slate-400 mt-0.5"><ion-icon name="time-outline" class="align-middle"></ion-icon> ${time} น.</div>
                        </div>`;
                    }

                    if (item.evidenceImage) {
                        evidenceBtn = `<button onclick="viewEvidence('${item.evidenceImage}')" class="p-2 text-blue-500 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition" title="ดูรูป">
                            <ion-icon name="image-outline" class="text-xl"></ion-icon>
                        </button>`;
                    }
                }

                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50 transition-colors";
                tr.innerHTML = `
                    <td class="px-6 py-4 text-slate-500 font-medium">${index + 1}</td>
                    <td class="px-6 py-4 font-black text-slate-800">${item.productCode}</td>
                    <td class="px-6 py-4 text-slate-600 max-w-[200px] truncate" title="${item.productName}">${item.productName}</td>
                    <td class="px-6 py-4 text-slate-600 font-medium"><span class="bg-slate-100 px-2 py-1 rounded-md">${item.branch}</span></td>
                    <td class="px-6 py-4">${statusBadge}</td>
                    <td class="px-6 py-4">${checkerInfo}</td>
                    <td class="px-6 py-4 text-center">${evidenceBtn}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        function viewEvidence(url) {
            Swal.fire({
                title: 'รูปหลักฐานการตรวจสอบ',
                imageUrl: url,
                imageAlt: 'Evidence',
                confirmButtonText: 'ปิดหน้าต่าง',
                confirmButtonColor: '#eab308'
            });
        }

        // Modal Controls
        function openComparisonModal() {
            document.getElementById('comparison-modal').classList.remove('hidden');
            // Default dates logic could go here if needed
        }

        function closeComparisonModal() {
            document.getElementById('comparison-modal').classList.add('hidden');
        }

        // Comparison feature logic
        async function compareStock() {
            const startVal = document.getElementById('comparison-start').value;
            const endVal = document.getElementById('comparison-end').value;

            if (!startVal || !endVal) {
                return Swal.fire('แจ้งเตือน', 'กรุณาระบุวันที่เริ่มต้นและสิ้นสุดให้ครบถ้วน', 'warning');
            }

            const startDate = new Date(startVal + 'T00:00:00').toISOString();
            const endDate = new Date(endVal + 'T23:59:59.999').toISOString();

            document.getElementById('comparison-summary-cards').style.display = 'grid';
            document.getElementById('comparison-table-container').style.display = 'block';
            
            const tbody = document.getElementById('comparison-table-body');
            tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-12 text-center text-slate-400"><div class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-yellow-500 rounded-full mb-2"></div><br>กำลังเปรียบเทียบข้อมูล...</td></tr>';

            try {
                const response = await fetch(`/api/daily-stocks/comparison?startDate=${startDate}&endDate=${endDate}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const data = await response.json();
                    
                    document.getElementById('comp-new').textContent = data.summary.newItems;
                    document.getElementById('comp-transferred').textContent = data.summary.transferredItems;
                    document.getElementById('comp-sold').textContent = data.summary.soldItems;

                    tbody.innerHTML = '';
                    if (data.changes.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-12 text-center text-slate-400">ไม่พบการเปลี่ยนแปลงใดๆ ระหว่าง 2 ช่วงเวลานี้</td></tr>';
                        return;
                    }

                    data.changes.forEach((item, index) => {
                        let statusBadge = '';
                        let details = '';

                        if (item.status === 'New') {
                            statusBadge = '<span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1"><ion-icon name="add-circle"></ion-icon> รายการใหม่</span>';
                            details = `<span class="text-slate-600 font-medium whitespace-nowrap bg-slate-100 px-2 py-1 rounded-md">เพิ่มที่สาขา: ${item.branch}</span>`;
                        } else if (item.status === 'Transferred') {
                            statusBadge = '<span class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1"><ion-icon name="swap-horizontal"></ion-icon> โอนย้ายสาขา</span>';
                            details = `<div class="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 inline-flex">
                                        <span class="font-medium text-slate-500">${item.oldBranch}</span>
                                        <ion-icon name="arrow-forward-outline" class="text-blue-500"></ion-icon>
                                        <span class="font-bold text-slate-800">${item.branch}</span>
                                       </div>`;
                        } else if (item.status === 'Sold') {
                            statusBadge = '<span class="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1"><ion-icon name="cart"></ion-icon> ขายออก (หรือถูกลบ)</span>';
                             details = `<span class="text-slate-400 text-sm italic line-through">เคยอยู่ที่สาขา: ${item.branch}</span>`;
                        }

                        const tr = document.createElement('tr');
                        tr.className = "hover:bg-slate-50 transition-colors";
                        tr.innerHTML = `
                            <td class="px-6 py-4 text-slate-500 font-medium">${index + 1}</td>
                            <td class="px-6 py-4 font-black text-slate-800">${item.productCode}</td>
                            <td class="px-6 py-4 text-slate-600 whitespace-nowrap overflow-hidden text-ellipsis max-w-xs" title="${item.productName}">${item.productName}</td>
                            <td class="px-6 py-4">${statusBadge}</td>
                            <td class="px-6 py-4">${details}</td>
                        `;
                        tbody.appendChild(tr);
                    });
                } else {
                    const errorData = await response.json();
                    tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-red-500">เรียกข้อมูลล้มเหลว: ${errorData.message || 'Error'}</td></tr>`;
                }
                
            } catch (e) {
                console.error('Error fetching comparison:', e);
                tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-red-500">เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์</td></tr>`;
            }
        }

        // Initialize on load
        // Initialize on load
        handleReportTypeChange();
        updateDashboard();
    