/**
 * Centralized API Fetch Wrapper (api.js)
 * จัดการเรื่องการแนบ Token และดักจับ Error กรณี Token หมดอายุ (401/403)
 */

async function fetchAPI(url, options = {}) {
    // 1. ดึง Token จาก localStorage
    const token = localStorage.getItem('token');

    // 2. จัดการ Headers
    const headers = {
        ...options.headers,
    };

    // หากไม่ใช่ FormData ให้ใส่ Content-Type เป็น application/json
    if (!(options.body instanceof FormData)) {
      if(!headers['Content-Type']){
          headers['Content-Type'] = 'application/json';
      }
    }

    // แนบ Token ไปกับ Header ถ้ามี Token
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // สร้าง options ใหม่เพื่อแนบเอา headers ที่อัปเดตแล้วส่งไป
    const config = {
        ...options,
        headers
    };

    try {
        // 3. ทำการส่ง Request ผ่าน fetch มาตรฐาน
        const response = await fetch(url, config);

        // 4. ตรวจสอบ Status Code (401 Unauthorized หรือ 403 Forbidden)
        if (response.status === 401 || response.status === 403) {
            console.warn('[API Wrapper] Token หมดอายุ หรือไม่มีสิทธิ์เข้าถึง (401/403)');
            
            // Force Logout: เคลียร์ token ออกจากระบบ
            localStorage.removeItem('token');
            localStorage.removeItem('user'); // เคลียร์ user data ด้วย (ถ้ามี)

            // แสดงหน้าต่าง Error เพื่อแจ้งเตือนผู้ใช้งาน (ระบบ SweetAlert2 หรือ Toast ที่มีอยู่)
            if (typeof Swal !== 'undefined') {
                await Swal.fire({
                    icon: 'warning',
                    title: 'เซสชันหมดอายุ',
                    text: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
                    confirmButtonText: 'ตกลง',
                    allowOutsideClick: false
                });
            } else {
                alert('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
            }

            // Redirect กลับไปยังหน้า Login
            window.location.href = '/';
            throw new Error('Unauthorized'); // โยน Error เพื่อหยุดการทำงานใน blocks ถัดไป
        }

        // หาก Request สำเร็จปกติ ให้ return ก้อน Response เดิมออกไปให้ฝั่งนั้นไป .json() เอาเอง
        // หรือจะเขียนบังคับ return response.json() ตรงนี้ไปเลยก็ได้ ขึ้นอยู่กับการเรียกใช้ส่วนใหญ่
        // แต่เพื่อความยืดหยุ่น ควร return response เผื่อกรณีไฟล์ ไม่ใช่ json
        return response;

    } catch (error) {
        // จัดการ Error อื่นๆ กรณี network error หรือ fetch พัง
        console.error('[API Wrapper Error]:', error);
        throw error;
    }
}
